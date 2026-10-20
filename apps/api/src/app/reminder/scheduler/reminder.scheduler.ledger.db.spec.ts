import { randomUUID } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
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

// RX-22b (RNX-193) AC4: a reminder run is one agent run on the credit ledger, paid by the reminder's owner
// (docs/credits.md section 13): one reservation, a usage entry per model call, and no write to the old counters
// (User.balance, Transaction, UserSubscription). Real ReminderScheduler, meter, CreditService and UsageService on the
// test database; fake provider. These collaborators load ESM-only packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../service/reminder.service", () => ({ ReminderService: class {} }));

const ECHO = { type: "function", function: { name: "echo", description: "Echo", parameters: {} } };

describe("RX-22b: reminder runs on the credit ledger (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: ReminderScheduler;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ReminderScheduler,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: ReminderService, useValue: {} },
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp: async () => [ECHO], executeTool: async () => "echo result" },
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
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** A due reminder of a user with old-path values that must not move (User.balance 5, counters 3 / 2,000). */
  const seedReminder = async (credits: string | null) => {
    const plan = await createPlan(prisma);
    const user = await createUser(prisma, { balance: new Decimal("5") });
    await createSubscription(prisma, { userId: user.id, planId: plan.id, messagesUsed: 3, tokensUsed: 2000n });
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

  const executeReminder = (reminder: unknown): Promise<void> => scheduler["executeReminder"](reminder);

  it("AC4: a reminder run is charged through the ledger, one entry per model call, and writes no old counter", async () => {
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
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const subscription = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect([after.balance.toFixed(6), subscription.messagesUsed, subscription.tokensUsed]).toEqual(["5.000000", 3, 2000n]);
    expect(await prisma.transaction.count()).toBe(0);
    await assertCreditLedgerInvariants(prisma);
  });

  it("an owner without ledger credits: the reminder run is refused with 402 before any model call (User.balance is not read)", async () => {
    const { reminder } = await seedReminder(null);

    await expect(executeReminder(reminder)).rejects.toThrow(CreditsExhaustedException);

    expect(fake.requests).toHaveLength(0);
    expect(await prisma.channelMessage.count()).toBe(0);
  });
});
