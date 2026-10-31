import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setRunCap } from "../../../../test/run-cap";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";

// RX-22b (RNX-193) AC4: a channel chat is one agent run on the credit ledger (docs/credits.md section 13): one
// reservation, a usage entry per model call attributed to the agent, the run and the caller who runs it (RNX-186 removed
// the old counters: User.balance, Transaction, the UserSubscription counters). Real ChannelChatService, ChannelService,
// meter, CreditService and UsageService on the test database; fake provider. These collaborators load ESM-only packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const ECHO = { type: "function", function: { name: "echo", description: "Echo", parameters: {} } };

describe("RX-22b: channel chat on the credit ledger (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelChatService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          ChannelService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async () => [ECHO],
              executeTool: async () => "echo result",
              cleanupMcpConnections: async () => undefined,
            },
          },
          {
            provide: AgentMemoryService,
            useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined },
          },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(ChannelChatService);
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

  /** A subscribed user with ledger credits and an agent in a channel. */
  const seed = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    return { user, agent, channel };
  };

  it("AC4: a channel chat is charged through the ledger, one entry per model call", async () => {
    const { user, agent, channel } = await seed();
    fake.enqueue(
      { toolCalls: [{ name: "echo", arguments: {} }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Done", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    const result = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(result.content).toBe("Done");
    const [reservation] = await prisma.creditReservation.findMany();
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
    expect(entries.map((e) => [e.agentId, e.runId, e.parentCallId, e.memberUserId, e.amount.toFixed(6)])).toEqual([
      [agent.id, reservation.runId, null, user.id, "-0.000042"],
      [agent.id, reservation.runId, null, user.id, "-0.000068"],
    ]);
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000110"]);
    expect(await prisma.usageLog.count({ where: { userId: user.id } })).toBe(2);
    await assertCreditLedgerInvariants(prisma);
  });

  it("a channel chat that reaches the per-run cap stops, saves the stop message and settles what ran", async () => {
    const { user, agent, channel } = await seed();
    await setRunCap(prisma, 0.01);
    // 9,900 + 10 micro-credits: the next call's E_call (its prompt + max_tokens 4,096) no longer fits under 0.01.
    fake.enqueue({ toolCalls: [{ name: "echo", arguments: {} }], usage: { prompt_tokens: 9_900, completion_tokens: 10 } });

    const result = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(result.content).toBe(budgetStopMessage(new Decimal("0.01")));
    expect(fake.requests).toHaveLength(1);
    const [reservation] = await prisma.creditReservation.findMany();
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.009910"]);
    const saved = await prisma.channelMessage.findMany({ where: { role: "assistant" } });
    expect(saved.map((m) => m.content)).toEqual([result.content]);
    await assertCreditLedgerInvariants(prisma);
  });
});
