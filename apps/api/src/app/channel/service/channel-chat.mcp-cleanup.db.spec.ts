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
import { createAgent, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setRunCap } from "../../../../test/run-cap";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";

// RNX-217 AC3: the MCP connections a channel run opened (buildToolSchemasWithMcp, into the run's own session) are
// closed exactly once, that session and no other, on every path: success, a refusal once the tools are built (the
// per-run cap, the reservation refused), a provider error and the budget stop. Real ChannelChatService, ChannelService,
// meter and CreditService on the test database; fake provider. These collaborators load ESM-only packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const ECHO = { type: "function", function: { name: "echo", description: "Echo", parameters: {} } };

describe("RNX-217 AC3: a channel run closes its own MCP connections exactly once on every path (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const buildToolSchemasWithMcp = jest.fn(async (..._args: unknown[]) => [ECHO]);
  const cleanupMcpConnections = jest.fn(async (_session: unknown) => undefined);
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
            useValue: { buildToolSchemasWithMcp, cleanupMcpConnections, executeTool: async () => "echo result" },
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
    buildToolSchemasWithMcp.mockClear();
    cleanupMcpConnections.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** A subscribed user funded with `credits` and an agent in a channel. */
  const seed = async (credits: string) => {
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: (await createPlan(prisma)).id });
    await fundPaidWallet(prisma, user.id, credits);
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    return { user, agent, channel };
  };

  /** The tools were built once into a session, and that same session was closed exactly once. */
  const expectOwnSessionClosedOnce = () => {
    const [buildCall] = buildToolSchemasWithMcp.mock.calls;
    const builtSession = (buildCall?.[4] as { mcpSession?: unknown } | undefined)?.mcpSession;
    expect([buildToolSchemasWithMcp.mock.calls.length, cleanupMcpConnections.mock.calls.length]).toEqual([1, 1]);
    expect(builtSession).toBeDefined();
    expect(cleanupMcpConnections.mock.calls[0][0]).toBe(builtSession);
  };

  it("success: closed once", async () => {
    const { user, agent, channel } = await seed("1");
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const result = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(result.content).toBe("Hello");
    expectOwnSessionClosedOnce();
    await assertCreditLedgerInvariants(prisma);
  });

  it("refusal after the tools are built (the first call over the per-run cap): 402 RUN_CAP_EXCEEDED, closed once", async () => {
    const { user, agent, channel } = await seed("1");
    await setRunCap(prisma, 0.001);

    await expect(service.chat(user.id, channel.id, agent.id, "Hi")).rejects.toMatchObject({
      status: 402,
      response: { code: "RUN_CAP_EXCEEDED" },
    });

    expectOwnSessionClosedOnce();
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.channelMessage.count()).toBe(0);
    await assertCreditLedgerInvariants(prisma);
  });

  it("refusal after the tools are built (the reservation refused: 2 micro-credits available): 402 CREDITS_EXHAUSTED, closed once", async () => {
    const { user, agent, channel } = await seed("0.000002");

    await expect(service.chat(user.id, channel.id, agent.id, "Hi")).rejects.toMatchObject({
      status: 402,
      response: { code: "CREDITS_EXHAUSTED" },
    });

    expectOwnSessionClosedOnce();
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.channelMessage.count()).toBe(0);
    await assertCreditLedgerInvariants(prisma);
  });

  it("provider error: rethrown, closed once, the hold released", async () => {
    const { user, agent, channel } = await seed("1");
    fake.enqueue({ error: { code: 502, message: "bad gateway" } });

    await expect(service.chat(user.id, channel.id, agent.id, "Hi")).rejects.toThrow();

    expectOwnSessionClosedOnce();
    expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["released"]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("budget stop: the stop message, closed once, what ran settled", async () => {
    const { user, agent, channel } = await seed("1");
    await setRunCap(prisma, 0.01);
    // 9,900 + 10 micro-credits: the next call's E_call (its prompt + max_tokens 4,096) no longer fits under 0.01.
    fake.enqueue({ toolCalls: [{ name: "echo", arguments: {} }], usage: { prompt_tokens: 9_900, completion_tokens: 10 } });

    const result = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(result.content).toBe(budgetStopMessage(new Decimal("0.01")));
    expectOwnSessionClosedOnce();
    expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["settled"]);
    await assertCreditLedgerInvariants(prisma);
  });
});
