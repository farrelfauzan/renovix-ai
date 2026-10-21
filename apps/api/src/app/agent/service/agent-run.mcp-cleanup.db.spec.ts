import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { AgentRunService } from "./agent-run.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { budgetStopMessage } from "../utils/budget-stop-message";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setRunCap } from "../../../../test/run-cap";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { AgentLinkService } from "./agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";

// RNX-200 AC4: the MCP connections opened for an agent run (buildToolSchemasWithMcp) are closed exactly once on every
// path: success, a refusal once the tools are built (the per-run cap on the real prompt, the reservation refused), a
// provider error and the budget stop. A refused message writes no run and no message. Real AgentRunService, meter and
// CreditService on the test database; fake provider. These collaborators load ESM-only packages.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const CALL_AGENT = {
  type: "function",
  function: { name: "call_agent", description: "Call", parameters: {} },
};

describe("RNX-200 AC4: an agent run closes its MCP connections on every path (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const buildToolSchemasWithMcp = jest.fn(
    async (_tools: unknown, _agentId: string, _userId?: string, _workspaceId?: string, options?: { injectCallAgent?: boolean }) =>
      options?.injectCallAgent ? [CALL_AGENT] : [],
  );
  const cleanupMcpConnections = jest.fn(async () => undefined);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: AgentToolService, useValue: { buildToolSchemasWithMcp, cleanupMcpConnections } },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
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
    service = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    buildToolSchemasWithMcp.mockClear();
    cleanupMcpConnections.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** Bob, subscribed and funded with `credits`, with an agent linked to his own helper (RNX-118). */
  const seed = async (credits: string) => {
    const bob = await createUser(prisma);
    await createSubscription(prisma, { userId: bob.id, planId: (await createPlan(prisma)).id });
    await fundPaidWallet(prisma, bob.id, credits);
    const parent = await createAgent(prisma, { userId: bob.id, status: "active" });
    const sub = await createAgent(prisma, { userId: bob.id, name: "Bob helper", status: "active" });
    await prisma.agentLink.create({ data: { callerAgentId: parent.id, calleeAgentId: sub.id } });
    return { bob, parent, sub };
  };

  /** The MCP tools were built for the run, then closed exactly once. */
  const expectMcpOpenedThenClosedOnce = () =>
    expect([buildToolSchemasWithMcp.mock.calls.length, cleanupMcpConnections.mock.calls.length]).toEqual([1, 1]);

  it("success: closed once", async () => {
    const { bob, parent } = await seed("1");
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const result = await service.chat(bob.id, parent.id, "Hi");

    expect(result.message.content).toBe("Hello");
    expectMcpOpenedThenClosedOnce();
    await assertCreditLedgerInvariants(prisma);
  });

  it("refusal after the tools are built (the first call over the per-run cap): 402 RUN_CAP_EXCEEDED, closed once, no run and no message", async () => {
    const { bob, parent } = await seed("1");
    await setRunCap(prisma, 0.001);

    await expect(service.chat(bob.id, parent.id, "Hi")).rejects.toMatchObject({
      status: 402,
      response: { code: "RUN_CAP_EXCEEDED" },
    });

    expectMcpOpenedThenClosedOnce();
    expect(fake.requests).toHaveLength(0);
    expect([await prisma.agentRun.count(), await prisma.agentMessage.count(), await prisma.creditReservation.count()]).toEqual([0, 0, 0]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("refusal after the tools are built (the reservation refused: 2 micro-credits available): 402 CREDITS_EXHAUSTED, closed once, no run and no message", async () => {
    const { bob, parent } = await seed("0.000002");

    await expect(service.chat(bob.id, parent.id, "Hi")).rejects.toMatchObject({
      status: 402,
      response: { code: "CREDITS_EXHAUSTED" },
    });

    expectMcpOpenedThenClosedOnce();
    expect(fake.requests).toHaveLength(0);
    expect([await prisma.agentRun.count(), await prisma.agentMessage.count(), await prisma.creditReservation.count()]).toEqual([0, 0, 0]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("provider error: rethrown, closed once, the hold released", async () => {
    const { bob, parent } = await seed("1");
    fake.enqueue({ error: { code: 502, message: "bad gateway" } });

    await expect(service.chat(bob.id, parent.id, "Hi")).rejects.toThrow();

    expectMcpOpenedThenClosedOnce();
    expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["released"]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("budget stop: the stop message, closed once, what ran settled", async () => {
    const { bob, parent, sub } = await seed("1");
    await setRunCap(prisma, 0.01);
    // 9,500 + 10 micro-credits: the sub-agent's E_call (its prompt + max_tokens 4,096) no longer fits under 0.01.
    fake.enqueue({
      toolCalls: [{ name: "call_agent", arguments: { agent: sub.id, task: "do it" } }],
      usage: { prompt_tokens: 9_500, completion_tokens: 10 },
    });

    const result = await service.chat(bob.id, parent.id, "Hi");

    expect(result.message.content).toBe(budgetStopMessage(new Decimal("0.01")));
    expectMcpOpenedThenClosedOnce();
    const messages = await prisma.agentMessage.findMany({ orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => [m.role, m.runId])).toEqual([
      ["user", result.runId],
      ["assistant", result.runId],
    ]);
    expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["settled"]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("a second message in the session sees the first exchange as history, once (the current message is not repeated)", async () => {
    const { bob, parent } = await seed("1");
    fake.enqueue(
      { content: "First", usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { content: "Second", usage: { prompt_tokens: 20, completion_tokens: 5 } },
    );

    const first = await service.chat(bob.id, parent.id, "Hi");
    await service.chat(bob.id, parent.id, "Again", first.sessionId);

    expect(fake.requests[1].messages.slice(1).map((m) => [m.role, m.content])).toEqual([
      ["user", "Hi"],
      ["assistant", "First"],
      ["user", "Again"],
    ]);
    expect(await prisma.agentRun.count()).toBe(1);
    await assertCreditLedgerInvariants(prisma);
  });
});
