import { randomUUID } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { ReminderScheduler } from "./reminder.scheduler";
import { ReminderService } from "../service/reminder.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { CreditsExhaustedException } from "../../billing/errors/credits-exhausted.exception";
import { UsageService } from "../../usage/service/usage.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";

// RX-22b (RNX-193) AC4: a reminder run is one agent run on the credit ledger, paid by the reminder's owner
// (docs/credits.md section 13): one reservation and a usage entry per model call (RNX-186 removed the old counters:
// User.balance, Transaction, the UserSubscription counters). Real ReminderScheduler, meter, CreditService and UsageService on the
// test database; fake provider. These collaborators load ESM-only packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../service/reminder.service", () => ({ ReminderService: class {} }));

const ECHO = { type: "function", function: { name: "echo", description: "Echo", parameters: {} } };

describe("RX-22b: reminder runs on the credit ledger (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const buildToolSchemasWithMcp = jest.fn(async (..._args: unknown[]) => [ECHO]);
  const cleanupMcpConnections = jest.fn(async (_session: unknown) => undefined);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: ReminderScheduler;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ReminderScheduler,
          AgentRunPolicyService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: ReminderService, useValue: {} },
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp, executeTool: async () => "echo result", cleanupMcpConnections },
          },
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "" } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    scheduler = moduleRef.get(ReminderScheduler);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    buildToolSchemasWithMcp.mockClear();
    cleanupMcpConnections.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** A due reminder of a subscribed user, funded on the ledger with `credits` (none when null). */
  const seedReminder = async (credits: string | null) => {
    const plan = await createPlan(prisma);
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    if (credits) await fundPaidWallet(prisma, user.id, credits);
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    const reminder = {
      id: randomUUID(),
      userId: user.id,
      channelId: channel.id,
      chatRoomId: room.id,
      prompt: "Daily summary please",
      nextRunAt: new Date(),
      agent: { ...agent, tools: [] },
    };
    return { user, agent, reminder };
  };

  // RNX-119: the run policy is checked in fireReminder; these runs are inside the owner's own workspace.
  const executeReminder = (reminder: unknown): Promise<void> => scheduler["executeReminder"](reminder, "inside");

  it("AC4: a reminder run is charged through the ledger, one entry per model call", async () => {
    const { user, agent, reminder } = await seedReminder("1");
    fake.enqueue(
      { toolCalls: [{ name: "echo", arguments: {} }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Here is your summary", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    await executeReminder(reminder);

    const [reservation] = await prisma.creditReservation.findMany();
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
    expect(entries.map((e) => [e.agentId, e.runId, e.memberUserId, e.amount.toFixed(6)])).toEqual([
      [agent.id, reservation.runId, user.id, "-0.000042"],
      [agent.id, reservation.runId, user.id, "-0.000068"],
    ]);
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000110"]);
    expect(await prisma.usageLog.count({ where: { userId: user.id } })).toBe(2);
    await assertCreditLedgerInvariants(prisma);
  });

  it("an owner without ledger credits: the reminder run is refused with 402 before any model call", async () => {
    const { reminder } = await seedReminder(null);

    await expect(executeReminder(reminder)).rejects.toThrow(CreditsExhaustedException);

    expect(fake.requests).toHaveLength(0);
    expect(await prisma.channelMessage.count()).toBe(0);
  });

  it("RNX-217: a reminder run closes the MCP session its tools were built into, exactly once (success and refusal)", async () => {
    const funded = await seedReminder("1");
    fake.enqueue({ content: "Here is your summary", usage: { prompt_tokens: 60, completion_tokens: 8 } });
    await executeReminder(funded.reminder);
    const unfunded = await seedReminder(null);
    await expect(executeReminder(unfunded.reminder)).rejects.toThrow(CreditsExhaustedException);

    const builtSessions = buildToolSchemasWithMcp.mock.calls.map((call) => (call[4] as { mcpSession?: unknown })?.mcpSession);
    expect([builtSessions.length, cleanupMcpConnections.mock.calls.length]).toEqual([2, 2]);
    expect(builtSessions.every((session) => session !== undefined)).toBe(true);
    expect(cleanupMcpConnections.mock.calls[0][0]).toBe(builtSessions[0]);
    expect(cleanupMcpConnections.mock.calls[1][0]).toBe(builtSessions[1]);
  });
});
