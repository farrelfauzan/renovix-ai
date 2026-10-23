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
import { MODEL_UNAVAILABLE_MESSAGE } from "../../config/errors/model-unavailable.exception";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { AgentLinkService } from "./agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";

// RX-22b (RNX-193): agent runs on the credit ledger (docs/credits.md section 13). One reservation per agent message
// with a new runId, one usage entry per model call (root and sub-agent hops) attributed to the agent, the run and the
// runner, the per-run cap (10 credits without a setting row) and the budget stop. Real AgentRunService, meter,
// CreditService and UsageService on the test database; fake provider. These collaborators load ESM-only packages.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const CALL_AGENT = {
  type: "function",
  function: { name: "call_agent", description: "Call", parameters: {} },
};

describe("RX-22b: agent runs on the credit ledger (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
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
          {
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectCallAgent?: boolean },
              ) => (options?.injectCallAgent ? [CALL_AGENT] : []),
              cleanupMcpConnections: async () => undefined,
            },
          },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
          },
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
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** Bob, subscribed and funded with `credits` (none for "0"), with an agent linked to his own helper (RNX-118). */
  const seed = async (credits: string) => {
    const plan = await createPlan(prisma);
    const bob = await createUser(prisma);
    await createSubscription(prisma, { userId: bob.id, planId: plan.id });
    if (new Decimal(credits).greaterThan(0)) await fundPaidWallet(prisma, bob.id, credits);
    const parent = await createAgent(prisma, { userId: bob.id, status: "active" });
    const sub = await createAgent(prisma, {
      userId: bob.id,
      name: "Bob helper",
      systemPrompt: "BOB SUB PROMPT",
      status: "active",
    });
    await prisma.agentLink.create({ data: { callerAgentId: parent.id, calleeAgentId: sub.id } });
    return { bob, parent, sub };
  };

  const delegateTurn = (subAgentId: string, usage: { prompt_tokens: number; completion_tokens: number }) => ({
    toolCalls: [{ name: "call_agent", arguments: { agent: subAgentId, task: "do it" } }],
    usage,
  });

  const usageEntriesOf = (userId: string) =>
    prisma.creditLedgerEntry.findMany({ where: { memberUserId: userId, type: "usage" }, orderBy: { seq: "asc" } });

  const accountOf = (userId: string) =>
    prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });

  describe("AC1: every model call of a run, root and hop, has a ledger line; their sum settles the run's one reservation", () => {
    it("root call, sub-agent hop, root answer: three usage entries with the agent, the run, the parent call and the runner", async () => {
      const { bob, parent, sub } = await seed("1");
      fake.enqueue(
        delegateTurn(sub.id, { prompt_tokens: 100, completion_tokens: 10 }),
        { content: "Sub answer", usage: { prompt_tokens: 50, completion_tokens: 20 } },
        { content: "Parent final", usage: { prompt_tokens: 200, completion_tokens: 30 } },
      );

      const result = await service.chat(bob.id, parent.id, "Hi");

      expect(result.message.content).toBe("Parent final");
      const entries = await usageEntriesOf(bob.id);
      const reservations = await prisma.creditReservation.findMany();
      expect(reservations).toHaveLength(1);
      const [reservation] = reservations;
      expect(entries).toHaveLength(fake.requests.length);
      expect(entries.map((e) => [e.agentId, e.parentCallId, e.runId, e.requestId, e.memberUserId, e.outcome, e.amount.toFixed(6)])).toEqual([
        [parent.id, null, reservation.runId, reservation.runId, bob.id, "completed", "-0.000110"],
        [sub.id, entries[0].callId, reservation.runId, reservation.runId, bob.id, "completed", "-0.000070"],
        [parent.id, null, reservation.runId, reservation.runId, bob.id, "completed", "-0.000230"],
      ]);
      const charged = entries.reduce((sum, e) => sum.plus(e.amount.negated()), new Decimal(0));
      expect([reservation.status, reservation.consumed.toFixed(6), charged.toFixed(6)]).toEqual(["settled", "0.000410", "0.000410"]);
      const account = await accountOf(bob.id);
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.999590", "0.000000"]);
      const logs = await prisma.usageLog.findMany({ where: { userId: bob.id }, orderBy: { createdAt: "asc" } });
      expect(logs.map((l) => l.cost.toFixed(6)).sort()).toEqual(["0.000070", "0.000110", "0.000230"]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("RX-178 review N3: a call to an agent whose model is not available answers the fixed text; the root calls are charged and settled", async () => {
      const { bob, parent, sub } = await seed("1");
      await prisma.agent.update({ where: { id: sub.id }, data: { model: "vendor/old-slug-without-a-row" } });
      fake.enqueue(
        delegateTurn(sub.id, { prompt_tokens: 100, completion_tokens: 10 }),
        { content: "Parent final", usage: { prompt_tokens: 200, completion_tokens: 30 } },
      );

      const result = await service.chat(bob.id, parent.id, "Hi");

      expect(result.message.content).toBe("Parent final");
      expect(fake.requests).toHaveLength(2);
      const toolResult = JSON.stringify(fake.requests[1].messages.filter((m: any) => m.role === "tool"));
      expect(toolResult).toContain(`Error: ${MODEL_UNAVAILABLE_MESSAGE}`);
      expect(toolResult).not.toContain("vendor/old-slug-without-a-row");
      const entries = await usageEntriesOf(bob.id);
      expect(entries.map((e) => [e.agentId, e.outcome, e.amount.toFixed(6)])).toEqual([
        [parent.id, "completed", "-0.000110"],
        [parent.id, "completed", "-0.000230"],
      ]);
      const [reservation] = await prisma.creditReservation.findMany();
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000340"]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("a provider error on the root call is charged 0 (outcome provider_error) and the hold is released", async () => {
      const { bob, parent } = await seed("1");
      fake.enqueue({ error: { code: 502, message: "bad gateway" } });

      await expect(service.chat(bob.id, parent.id, "Hi")).rejects.toThrow();

      const entries = await usageEntriesOf(bob.id);
      expect(entries.map((e) => [e.outcome, e.amount.toFixed(6), e.agentId])).toEqual([["provider_error", "0.000000", parent.id]]);
      const [reservation] = await prisma.creditReservation.findMany();
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["released", "0.000000"]);
      const account = await accountOf(bob.id);
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["1.000000", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("a provider error on a hop is charged 0; the run goes on and settles what ran", async () => {
      const { bob, parent, sub } = await seed("1");
      fake.enqueue(
        delegateTurn(sub.id, { prompt_tokens: 100, completion_tokens: 10 }),
        { error: { code: 502, message: "bad gateway" } },
        { content: "Parent final", usage: { prompt_tokens: 200, completion_tokens: 30 } },
      );

      await service.chat(bob.id, parent.id, "Hi");

      const entries = await usageEntriesOf(bob.id);
      expect(entries.map((e) => [e.agentId, e.outcome, e.amount.toFixed(6)])).toEqual([
        [parent.id, "completed", "-0.000110"],
        [sub.id, "provider_error", "0.000000"],
        [parent.id, "completed", "-0.000230"],
      ]);
      const [reservation] = await prisma.creditReservation.findMany();
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000340"]);
      await assertCreditLedgerInvariants(prisma);
    });
    it("an error that ends the run after calls were charged settles the reservation with what ran (released means nothing charged)", async () => {
      const { bob, parent, sub } = await seed("1");
      fake.enqueue(
        delegateTurn(sub.id, { prompt_tokens: 100, completion_tokens: 10 }),
        { content: "Sub answer", usage: { prompt_tokens: 50, completion_tokens: 5 } },
        { error: { code: 502, message: "bad gateway" } },
      );

      await expect(service.chat(bob.id, parent.id, "Hi")).rejects.toThrow();

      const entries = await usageEntriesOf(bob.id);
      expect(entries.map((e) => [e.agentId, e.outcome, e.amount.toFixed(6)])).toEqual([
        [parent.id, "completed", "-0.000110"],
        [sub.id, "completed", "-0.000055"],
        [parent.id, "provider_error", "0.000000"],
      ]);
      const [reservation] = await prisma.creditReservation.findMany();
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000165"]);
      const account = await accountOf(bob.id);
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.999835", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC2: the per-run cap and the budget stop", () => {
    it("without a setting row the cap is 10 credits: the hold is min(10, available)", async () => {
      const { bob, parent } = await seed("25");
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      await service.chat(bob.id, parent.id, "Hi");

      const [reservation] = await prisma.creditReservation.findMany();
      expect(reservation.amountHeld.toFixed(6)).toBe("10.000000");
      await assertCreditLedgerInvariants(prisma);
    });

    it("a cap setting below the floor is raised to the floor (1 credit without a floor row)", async () => {
      const { bob, parent } = await seed("25");
      await prisma.platformSetting.create({ data: { name: "perRunCreditCap", value: 0.5 } });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      await service.chat(bob.id, parent.id, "Hi");

      const [reservation] = await prisma.creditReservation.findMany();
      expect(reservation.amountHeld.toFixed(6)).toBe("1.000000");
      await assertCreditLedgerInvariants(prisma);
    });

    it("a run that reaches the cap stops before the next call (a hop), settles what ran, and nothing more is charged", async () => {
      const { bob, parent, sub } = await seed("1");
      await setRunCap(prisma, 0.01);
      // 9,500 + 10 micro-credits: the sub-agent's E_call (its prompt + max_tokens 4,096) no longer fits under 0.01.
      fake.enqueue(delegateTurn(sub.id, { prompt_tokens: 9_500, completion_tokens: 10 }));

      const result = await service.chat(bob.id, parent.id, "Hi");

      expect(result.message.content).toBe(budgetStopMessage(new Decimal("0.01")));
      expect(fake.requests).toHaveLength(1);
      const entries = await usageEntriesOf(bob.id);
      expect(entries.map((e) => e.amount.toFixed(6))).toEqual(["-0.009510"]);
      const [reservation] = await prisma.creditReservation.findMany();
      expect([reservation.status, reservation.amountHeld.toFixed(6), reservation.consumed.toFixed(6)]).toEqual([
        "settled",
        "0.010000",
        "0.009510",
      ]);
      const account = await accountOf(bob.id);
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.990490", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("RNX-16 budget stop (AR): the stored assistant message holds the budget-stop text after the user message, with 0 tokens (the call that ran is not counted) and no cost", async () => {
      const { bob, parent, sub } = await seed("1");
      await setRunCap(prisma, 0.01);
      fake.enqueue(delegateTurn(sub.id, { prompt_tokens: 9_500, completion_tokens: 10 }));
      const expectedContent = budgetStopMessage(new Decimal("0.01"));

      const actual = await service.chat(bob.id, parent.id, "Hi");

      const stored = await prisma.agentMessage.findMany({ where: { runId: actual.runId }, orderBy: { createdAt: "asc" } });
      expect(stored.map((m) => [m.role, m.content, m.tokens, m.cost])).toEqual([
        ["user", "Hi", null, null],
        ["assistant", expectedContent, 0, null],
      ]);
      expect(actual.usage).toEqual({ totalTokens: 0, cost: undefined });
    });

    it("with less available than the cap, the hold is the whole available balance; the budget stop keeps the balance at or above 0", async () => {
      const { bob, parent, sub } = await seed("0.02");
      fake.enqueue(delegateTurn(sub.id, { prompt_tokens: 18_000, completion_tokens: 10 }));

      const result = await service.chat(bob.id, parent.id, "Hi");

      expect(result.message.content).toBe(budgetStopMessage(new Decimal("0.02")));
      const [reservation] = await prisma.creditReservation.findMany();
      expect([reservation.status, reservation.amountHeld.toFixed(6), reservation.consumed.toFixed(6)]).toEqual([
        "settled",
        "0.020000",
        "0.018010",
      ]);
      const account = await accountOf(bob.id);
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["0.001990", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("a first call that alone is over the cap is refused before it starts, naming the cap; nothing is reserved", async () => {
      const { bob, parent } = await seed("1");
      await setRunCap(prisma, 0.001);

      await expect(service.chat(bob.id, parent.id, "Hi")).rejects.toMatchObject({
        status: 402,
        response: { code: "RUN_CAP_EXCEEDED", message: expect.stringContaining("0.001 credits") },
      });

      expect(fake.requests).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
    });

    it("no available credits: 402 CREDITS_EXHAUSTED before any write or model call", async () => {
      const { bob, parent } = await seed("0");

      await expect(service.chat(bob.id, parent.id, "Hi")).rejects.toMatchObject({ status: 402 });

      expect(fake.requests).toHaveLength(0);
      expect(await prisma.agentMessage.count()).toBe(0);
      expect(await prisma.creditReservation.count()).toBe(0);
    });
  });

  describe("AC3: one runId per agent message", () => {
    it("two messages in one session: one AgentRun session, two reservations with two different runIds, none the session's id", async () => {
      const { bob, parent } = await seed("1");
      fake.enqueue(
        { content: "First", usage: { prompt_tokens: 10, completion_tokens: 5 } },
        { content: "Second", usage: { prompt_tokens: 20, completion_tokens: 5 } },
      );

      const first = await service.chat(bob.id, parent.id, "Hi");
      const second = await service.chat(bob.id, parent.id, "Again", first.sessionId);

      expect(second.runId).toBe(first.runId);
      expect(await prisma.agentRun.count()).toBe(1);
      const reservations = await prisma.creditReservation.findMany({ orderBy: { createdAt: "asc" } });
      const runIds = reservations.map((r) => r.runId);
      expect(new Set(runIds).size).toBe(2);
      expect(runIds).not.toContain(first.runId);
      const entries = await usageEntriesOf(bob.id);
      expect(entries.map((e) => e.runId)).toEqual(runIds);
      await assertCreditLedgerInvariants(prisma);
    });
  });
});
