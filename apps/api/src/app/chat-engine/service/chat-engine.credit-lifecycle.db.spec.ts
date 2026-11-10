import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatEngineService } from "./chat-engine.service";
import { ChatEngineMeterService } from "./chat-engine-meter.service";
import { ChatEngineContextService } from "./chat-engine-context.service";
import { ChatEngineExecution } from "../ports/chat-engine-execution.port";
import { ChatEngineOutputApproval } from "../ports/chat-engine-output-approval.port";
import { ChatEnginePersistence } from "../ports/chat-engine-persistence.port";
import { EMPTY_CHAT_ENGINE_RESULT } from "../config/empty-chat-engine-result";
import { applyChatEngineEvent } from "../utils/apply-chat-engine-event";
import type { ChatEngineEvent } from "../types/chat-engine-event";
import type { ChatEngineResult } from "../types/chat-engine-result";
import type { ChatExecutionChunk } from "../types/chat-execution-chunk";
import type { ChatExecutionInput } from "../types/chat-execution-input";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import { CreditService } from "../../billing/service/credit.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { MODEL_UNAVAILABLE_MESSAGE } from "../../config/errors/model-unavailable.exception";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import type { ChatRequest } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { UsageService } from "../../usage/service/usage.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setRunCap } from "../../../../test/run-cap";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-282: the chat engine's model calls on the existing credit lifecycle. Real ChatEngineService, ChatEngineMeterService,
// AgentRunMeterService, CreditService, run policy, model registry and UsageService on the test database; the model is
// the fake provider. The ports (execution, output approval, persistence) are test doubles: the execution is scripted
// and reaches the model only through the metered `callModel` it is given. Non-default rates (2 / 1 / 3 per token, in
// micro-credits) and run caps. These collaborators load ESM-only packages and are stubbed.
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./chat-engine-context.service", () => ({ ChatEngineContextService: class {} }));

/** max_tokens of every scripted call: with output at 3 per token, E_call is about 0.00032 credits for the prompt "Hi". */
const CALL_MAX_TOKENS = 100;
const OFFERED_TOOL = "lookup";
const MODES = [["streamed"], ["collected"]] as const;
type Mode = (typeof MODES)[number][0];
/** One scripted step of the execution: a metered model call (its text is yielded), two calls started together, a tool result, or a failure. */
type Step = "call" | "pair" | "tool" | "throw";

describe("RNX-282: the chat engine on the credit ledger (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const script: Step[] = [];
  const execution = {
    execute: jest.fn(async function* (input: ChatExecutionInput): AsyncGenerator<ChatExecutionChunk> {
      for (const step of script) {
        if (step === "throw") throw new Error("execution failed");
        if (step === "tool") yield { type: "tool_result", toolName: OFFERED_TOOL, content: "tool says hi" };
        const request = { messages: [{ role: "user" as const, content: input.approvedInput }], max_tokens: CALL_MAX_TOKENS };
        const calls = step === "call" ? [input.callModel(request)] : step === "pair" ? [input.callModel(request), input.callModel(request)] : [];
        const settled = await Promise.allSettled(calls);
        for (const call of settled) if (call.status === "fulfilled") yield { type: "text", text: call.value.response.choices[0].message.content ?? "" };
        const refused = settled.find((call) => call.status === "rejected");
        if (refused) throw refused.reason;
      }
    }),
  };
  const outputApproval = {
    approveOutput: jest.fn(async (content: string) => ({ status: "approved" as const, content })),
    approveToolResult: jest.fn(async (content: string) => ({ status: "approved" as const, content })),
  };
  const persistence = { saveExchange: jest.fn(async () => undefined), handToMemory: jest.fn(async () => undefined) };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let engine: ChatEngineService;
  let credits: CreditService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChatEngineService,
          ChatEngineMeterService,
          AgentRunMeterService,
          AgentRunPolicyService,
          WorkspaceQuotaService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
          {
            provide: ChatEngineContextService,
            useValue: { buildContext: async () => ({ scope: "inside", memory: "", knowledge: "", offeredTools: [{ name: OFFERED_TOOL, description: "" }] }) },
          },
          { provide: ChatEngineExecution, useValue: execution },
          { provide: ChatEngineOutputApproval, useValue: outputApproval },
          { provide: ChatEnginePersistence, useValue: persistence },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    engine = moduleRef.get(ChatEngineService);
    credits = moduleRef.get(CreditService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    // A test that fails before its scripted turns are used must not hand them to the next test.
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    script.length = 0;
    jest.clearAllMocks();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 2, cachedCreditsPerToken: 1, outputCreditsPerToken: 3 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** Bob, subscribed (unless `subscribed` is false) and funded with `credits` (none for "0"), with his own active agent. */
  const seed = async ({ credits: funded = "1", subscribed = true, model = "test-model" } = {}) => {
    const bob = await createUser(prisma);
    if (subscribed) await createPackageSnapshot(prisma, { userId: bob.id });
    if (new Decimal(funded).greaterThan(0)) await fundPaidWallet(prisma, bob.id, funded);
    const agent = await createAgent(prisma, { userId: bob.id, status: "active", model });
    const request = { principal: { runnerUserId: bob.id }, source: "agent-run", conversation: { agentId: agent.id }, input: "Hi", options: { offeredTools: [{ name: OFFERED_TOOL }] } };
    return { bob, agent, request };
  };

  /** The run in one output mode: the streamed events folded as `collect` folds them (with their types), or `collect` itself. */
  const runIn = async (mode: Mode, request: unknown): Promise<{ result: ChatEngineResult; seen: ChatEngineEvent["type"][] }> => {
    if (mode === "collected") return { result: await engine.collect(request), seen: [] };
    const seen: ChatEngineEvent["type"][] = [];
    let result = EMPTY_CHAT_ENGINE_RESULT;
    for await (const event of engine.run(request)) {
      seen.push(event.type);
      result = applyChatEngineEvent(result, event);
    }
    return { result, seen };
  };

  /** Runs in `mode` and returns the error it ends with, and the event types a streamed consumer saw before it. */
  const failIn = async (mode: Mode, request: unknown): Promise<{ error: unknown; seen: ChatEngineEvent["type"][] }> => {
    const seen: ChatEngineEvent["type"][] = [];
    try {
      if (mode === "collected") await engine.collect(request);
      else for await (const event of engine.run(request)) seen.push(event.type);
    } catch (error) {
      return { error, seen };
    }
    throw new Error("the run did not fail");
  };

  /** A streamed run read until its first tool_result event, then left suspended there. */
  const suspendAtToolResult = async (request: unknown): Promise<AsyncGenerator<ChatEngineEvent>> => {
    const events = engine.run(request);
    for (let next = await events.next(); !next.done; next = await events.next()) {
      if (next.value.type === "tool_result") return events;
    }
    throw new Error("no tool_result event");
  };

  const usageEntries = () => prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
  const accountOf = (userId: string) => prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });
  const reservationRows = () => prisma.creditReservation.findMany();
  const closeCounts = () => ({ settle: jest.spyOn(credits, "settle"), release: jest.spyOn(credits, "release") });

  /** The account's balance and held, the run's one reservation's status, held and consumed, and the usage entries' outcome and amount. */
  const moneyOf = async (userId: string) => {
    const account = await accountOf(userId);
    const reservations = await reservationRows();
    const entries = await usageEntries();
    return {
      balance: account.balance.toFixed(6),
      held: account.held.toFixed(6),
      reservations: reservations.map((r) => [r.status, r.amountHeld.toFixed(6), r.consumed.toFixed(6)]),
      entries: entries.map((e) => [e.outcome, e.amount.toFixed(6)]),
    };
  };

  describe("AC1: a funded run reserves first, records each call once, charges per the existing policy and releases the rest", () => {
    it.each(MODES)("%s: one reservation of min(cap, available), placed before the provider call; one usage entry; settled with the unused hold released", async (mode) => {
      const { bob, request } = await seed({ credits: "2" });
      await setRunCap(prisma, 0.5);
      script.push("call");
      fake.enqueue({ content: "The answer", usage: { prompt_tokens: 30, cached_tokens: 10, completion_tokens: 20 } });
      const openHoldsAtCall: number[] = [];
      const providerChat = fake.chat.bind(fake);
      jest.spyOn(fake, "chat").mockImplementation(async (params: ChatRequest) => {
        openHoldsAtCall.push(await prisma.creditReservation.count({ where: { status: "open" } }));
        return providerChat(params);
      });
      const { settle, release } = closeCounts();
      const { result, seen } = await runIn(mode, request);
      expect([result.status, result.content]).toEqual(["completed", "The answer"]);
      if (mode === "streamed") expect(seen).toEqual(["context", "content", "done"]);
      expect(openHoldsAtCall).toEqual([1]);
      // 20 new x 2 + 10 cached x 1 + 20 out x 3 = 110 micro-credits.
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.999890", held: "0.000000", reservations: [["settled", "0.500000", "0.000110"]], entries: [["completed", "-0.000110"]] });
      const [entry] = await usageEntries();
      const [reservation] = await reservationRows();
      expect([entry.agentId, entry.memberUserId, entry.runId, entry.parentCallId, entry.modelId]).toEqual([request.conversation.agentId, bob.id, reservation.runId, null, "test-model"]);
      expect((await prisma.usageLog.findMany({ where: { userId: bob.id } })).map((l) => l.cost.toFixed(6))).toEqual(["0.000110"]);
      expect([settle.mock.calls.length, release.mock.calls.length]).toEqual([1, 0]);
      expect(persistence.saveExchange).toHaveBeenCalledTimes(1);
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: two calls with a tool result between them share the one reservation; each has its own entry", async (mode) => {
      const { bob, request } = await seed();
      script.push("call", "tool", "call");
      fake.enqueue({ content: "First ", usage: { prompt_tokens: 10, completion_tokens: 5 } }, { content: "second", usage: { prompt_tokens: 20, completion_tokens: 10 } });
      const { result } = await runIn(mode, request);
      expect([result.content, result.toolResults]).toEqual(["First second", [{ toolName: OFFERED_TOOL, content: "tool says hi" }]]);
      // 10 x 2 + 5 x 3 = 35, then 20 x 2 + 10 x 3 = 70 micro-credits; the default cap (no setting row) holds 1.
      expect(await moneyOf(bob.id)).toEqual({
        balance: "0.999895",
        held: "0.000000",
        reservations: [["settled", "1.000000", "0.000105"]],
        entries: [["completed", "-0.000035"], ["completed", "-0.000070"]],
      });
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC2: refused before any provider call, debit or hold", () => {
    it.each(MODES)("%s: no credits: 402 CREDITS_EXHAUSTED at the reservation, no provider call, nothing written", async (mode) => {
      const { request } = await seed({ credits: "0" });
      script.push("call");
      const { error } = await failIn(mode, request);
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
      expect(fake.requests).toHaveLength(0);
      expect([await reservationRows(), await usageEntries()]).toEqual([[], []]);
      expect(persistence.saveExchange).not.toHaveBeenCalled();
    });

    it.each(MODES)("%s: available below the call's estimate: 402, no provider call, no hold left", async (mode) => {
      const { bob, request } = await seed({ credits: "0.0001" });
      script.push("call");
      const { error } = await failIn(mode, request);
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
      expect(fake.requests).toHaveLength(0);
      expect(await moneyOf(bob.id)).toEqual({ balance: "0.000100", held: "0.000000", reservations: [], entries: [] });
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: an unknown model: the fixed 400 before the execution runs; no provider call, nothing reserved", async (mode) => {
      const { bob, request } = await seed({ model: "vendor/no-such-model" });
      script.push("call");
      const { error } = await failIn(mode, request);
      expect((error as Error).message).toBe(MODEL_UNAVAILABLE_MESSAGE);
      expect(execution.execute).not.toHaveBeenCalled();
      expect(fake.requests).toHaveLength(0);
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });

    it.each(MODES)("%s: a model on an inactive provider: the fixed 400 before the execution runs; no provider call, nothing reserved", async (mode) => {
      await createResolvableModel(prisma, { slug: "inactive-model", modelName: "inactive-model", provider: { status: "inactive" } });
      await moduleRef.get(ModelRegistryService).refresh();
      const { bob, request } = await seed({ model: "inactive-model" });
      script.push("call");
      const { error } = await failIn(mode, request);
      expect((error as Error).message).toBe(MODEL_UNAVAILABLE_MESSAGE);
      expect(execution.execute).not.toHaveBeenCalled();
      expect(fake.requests).toHaveLength(0);
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });

    it.each(MODES)("%s: a runner without a subscription is denied (no_subscription) by the run policy: nothing reserved or called", async (mode) => {
      const { bob, request } = await seed({ subscribed: false });
      script.push("call");
      const { result } = await runIn(mode, request);
      expect([result.status, result.reason]).toEqual(["denied", "no_subscription"]);
      expect(execution.execute).not.toHaveBeenCalled();
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });

    it("an invalid request is a ZodError before anything is read, reserved or called", async () => {
      const { bob, request } = await seed();
      await expect(engine.collect({ ...request, input: "" })).rejects.toThrow();
      await expect(engine.collect({ ...request, principal: {} })).rejects.toThrow();
      expect(execution.execute).not.toHaveBeenCalled();
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });
  });

  describe("AC3: the budget stop (non-default per-run cap)", () => {
    it.each(MODES)("%s: the next call over the hold is refused, the completed call is kept and settled, the stop message is the approved answer", async (mode) => {
      const { bob, request } = await seed();
      // H = 0.00045; E_call is about 0.00032; after a call of 220 micro-credits the next E_call no longer fits.
      await setRunCap(prisma, 0.00045);
      script.push("call", "tool", "call");
      fake.enqueue({ content: "partial", usage: { prompt_tokens: 50, completion_tokens: 40 } });
      const { result } = await runIn(mode, request);
      const stop = budgetStopMessage(new Decimal("0.00045"));
      expect([result.status, result.content]).toEqual(["completed", stop]);
      expect(outputApproval.approveOutput).toHaveBeenCalledWith(stop, bob.id, request.conversation.agentId);
      expect(fake.requests).toHaveLength(1);
      expect(await moneyOf(bob.id)).toEqual({ balance: "0.999780", held: "0.000000", reservations: [["settled", "0.000450", "0.000220"]], entries: [["completed", "-0.000220"]] });
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: two calls started together: the second waits for the first's charge, then stops at the budget; charged <= cap, closed once", async (mode) => {
      const { bob, request } = await seed();
      await setRunCap(prisma, 0.00045);
      script.push("pair");
      fake.enqueue({ content: "first", usage: { prompt_tokens: 50, completion_tokens: 40 } }, { content: "second", usage: { prompt_tokens: 100, completion_tokens: 80 } });
      const { settle, release } = closeCounts();
      const { result } = await runIn(mode, request);
      expect(result.content).toBe(budgetStopMessage(new Decimal("0.00045")));
      expect(fake.requests).toHaveLength(1);
      expect(await moneyOf(bob.id)).toEqual({ balance: "0.999780", held: "0.000000", reservations: [["settled", "0.000450", "0.000220"]], entries: [["completed", "-0.000220"]] });
      expect([settle.mock.calls.length, release.mock.calls.length]).toEqual([1, 0]);
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: a first call alone over the cap: RUN_CAP_EXCEEDED before any hold or call", async (mode) => {
      const { bob, request } = await seed();
      await setRunCap(prisma, 0.0001);
      script.push("call");
      const { error } = await failIn(mode, request);
      expect((error as { getResponse(): unknown }).getResponse()).toMatchObject({ code: "RUN_CAP_EXCEEDED" });
      expect(fake.requests).toHaveLength(0);
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });
  });

  describe("AC4: provider failures", () => {
    it.each(MODES)("%s: before any output: one provider_error entry of 0, the hold released, the error reaches the caller", async (mode) => {
      const { bob, request } = await seed();
      script.push("call");
      fake.enqueue({ error: { code: 400, message: "bad request" } });
      const { error, seen } = await failIn(mode, request);
      expect((error as { status: number }).status).toBe(400);
      if (mode === "streamed") expect(seen).toEqual(["context"]);
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [["released", "1.000000", "0.000000"]], entries: [["provider_error", "0.000000"]] });
      expect(persistence.saveExchange).not.toHaveBeenCalled();
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: mid-stream (after a charged call and a streamed tool result): the failed call is charged 0, what ran stays charged and is settled", async (mode) => {
      const { bob, request } = await seed();
      script.push("call", "tool", "call");
      fake.enqueue({ content: "first", usage: { prompt_tokens: 10, completion_tokens: 5 } }, { error: { code: 502, message: "bad gateway" } });
      const { error, seen } = await failIn(mode, request);
      expect((error as { status: number }).status).toBe(502);
      if (mode === "streamed") expect(seen).toEqual(["context", "tool_result"]);
      expect(await moneyOf(bob.id)).toEqual({
        balance: "0.999965",
        held: "0.000000",
        reservations: [["settled", "1.000000", "0.000035"]],
        entries: [["completed", "-0.000035"], ["provider_error", "0.000000"]],
      });
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: RNX-16 router fallback: a 503 moves the call to the fallback model; one provider_error entry for the failed attempt", async (mode) => {
      const fallback = await createResolvableModel(prisma, { slug: "fallback-model", modelName: "fallback-model", maxTokens: 8192 });
      const primary = await prisma.aiModel.findFirstOrThrow({ where: { slug: "test-model" } });
      await prisma.aiModelFallback.create({ data: { modelId: primary.id, fallbackModelId: fallback.model.id, position: 0 } });
      await moduleRef.get(ModelRegistryService).refresh();
      const { bob, request } = await seed();
      script.push("call");
      fake.enqueue({ error: { code: 503, message: "unavailable" } }, { content: "From fallback", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const { result } = await runIn(mode, request);
      expect(result.content).toBe("From fallback");
      expect(fake.requests.map((r) => r.connection.slug)).toEqual(["test-model", "fallback-model"]);
      expect((await usageEntries()).map((e) => [e.outcome, e.modelId, e.amount.toFixed(6)])).toEqual([
        ["provider_error", "test-model", "0.000000"],
        ["completed", "fallback-model", "-0.000035"],
      ]);
      expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "1.000000", "0.000035"]]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC5: abort, disconnect and exceptions finalize the hold once and stop the work", () => {
    it("disconnect (the consumer stops iterating) after a charged call: no further call, settled once, nothing persisted", async () => {
      const { bob, request } = await seed();
      script.push("call", "tool", "call");
      fake.enqueue({ content: "first", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const { settle, release } = closeCounts();
      for await (const event of engine.run(request)) if (event.type === "tool_result") break;
      expect(fake.requests).toHaveLength(1);
      expect([settle.mock.calls.length, release.mock.calls.length]).toEqual([1, 0]);
      expect(await moneyOf(bob.id)).toEqual({ balance: "0.999965", held: "0.000000", reservations: [["settled", "1.000000", "0.000035"]], entries: [["completed", "-0.000035"]] });
      expect([outputApproval.approveOutput.mock.calls.length, persistence.saveExchange.mock.calls.length]).toEqual([0, 0]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("disconnect before the first model call: the execution never runs, nothing is reserved", async () => {
      const { bob, request } = await seed();
      script.push("call");
      for await (const event of engine.run(request)) if (event.type === "context") break;
      expect(execution.execute).not.toHaveBeenCalled();
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });

    it("abort (the consumer throws into the run) before any model call: no call is made, nothing is reserved or closed", async () => {
      const { bob, request } = await seed();
      script.push("tool", "call");
      const { settle, release } = closeCounts();
      const events = engine.run(request);
      let next = await events.next();
      while (!next.done && next.value.type !== "tool_result") next = await events.next();
      await expect(events.throw(new Error("aborted"))).rejects.toThrow("aborted");
      expect(fake.requests).toHaveLength(0);
      expect([settle.mock.calls.length, release.mock.calls.length]).toEqual([0, 0]);
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });

    it("abort after a charged call: no further call, settled once", async () => {
      const { bob, request } = await seed();
      script.push("call", "tool", "call");
      fake.enqueue({ content: "first", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const { settle, release } = closeCounts();
      const events = await suspendAtToolResult(request);
      await expect(events.throw(new Error("aborted"))).rejects.toThrow("aborted");
      expect(fake.requests).toHaveLength(1);
      expect([settle.mock.calls.length, release.mock.calls.length]).toEqual([1, 0]);
      expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "1.000000", "0.000035"]]);
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: an exception in the execution after a charged call: settled once, nothing persisted", async (mode) => {
      const { bob, request } = await seed();
      script.push("call", "throw");
      fake.enqueue({ content: "first", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const { settle, release } = closeCounts();
      const { error } = await failIn(mode, request);
      expect((error as Error).message).toBe("execution failed");
      expect([settle.mock.calls.length, release.mock.calls.length]).toEqual([1, 0]);
      expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "1.000000", "0.000035"]]);
      expect(persistence.saveExchange).not.toHaveBeenCalled();
      await assertCreditLedgerInvariants(prisma);
    });

    it.each(MODES)("%s: an exception after the run closed (the output approval throws): the hold was settled once, never again", async (mode) => {
      const { bob, request } = await seed();
      script.push("call");
      fake.enqueue({ content: "answer", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      outputApproval.approveOutput.mockRejectedValueOnce(new Error("approval down"));
      const { settle, release } = closeCounts();
      const { error } = await failIn(mode, request);
      expect((error as Error).message).toBe("approval down");
      expect([settle.mock.calls.length, release.mock.calls.length]).toEqual([1, 0]);
      expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "1.000000", "0.000035"]]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("process death: a run left open is expired by the sweep (hold released); its late close changes nothing", async () => {
      const { bob, request } = await seed();
      script.push("call", "tool", "call");
      fake.enqueue({ content: "first", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const events = await suspendAtToolResult(request);
      expect((await moneyOf(bob.id)).held).toBe("0.999965");
      expect(await credits.expireOverdueReservations(new Date(Date.now() + 60 * 60_000))).toBe(1);
      const swept = await moneyOf(bob.id);
      expect(swept).toEqual({ balance: "0.999965", held: "0.000000", reservations: [["expired", "1.000000", "0.000035"]], entries: [["completed", "-0.000035"]] });
      await events.return(undefined);
      expect(await moneyOf(bob.id)).toEqual(swept);
      expect(fake.requests).toHaveLength(1);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC6: repeated and concurrent finalize, identical and conflicting replays", () => {
    it("concurrent finalize of an open run (the engine's own close, settle, release and the sweep): closed once, the hold released once", async () => {
      const { bob, request } = await seed();
      script.push("call", "tool", "call");
      fake.enqueue({ content: "first", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const events = await suspendAtToolResult(request);
      const [reservation] = await reservationRows();
      await Promise.all([
        events.return(undefined),
        credits.settle(reservation.id),
        credits.release(reservation.id),
        credits.settle(reservation.id),
        credits.expireOverdueReservations(new Date(Date.now() + 60 * 60_000)),
      ]);
      const money = await moneyOf(bob.id);
      expect([money.balance, money.held, money.entries]).toEqual(["0.999965", "0.000000", [["completed", "-0.000035"]]]);
      expect(money.reservations).toHaveLength(1);
      expect(money.reservations[0].slice(1)).toEqual(["1.000000", "0.000035"]);
      expect(fake.requests).toHaveLength(1);
      await assertCreditLedgerInvariants(prisma);
    });

    it("repeated finalize after a completed run (closeRun twice, settle and release): nothing changes", async () => {
      const { bob, request } = await seed();
      script.push("call");
      fake.enqueue({ content: "answer", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await engine.collect(request);
      const before = await moneyOf(bob.id);
      const [reservation] = await reservationRows();
      const run = { runId: reservation.runId ?? "", reservationId: reservation.id, runnerUserId: bob.id, held: reservation.amountHeld, spent: new Decimal(0) };
      const meter = moduleRef.get(AgentRunMeterService);
      await Promise.all([meter.closeRun(run, "failed"), meter.closeRun(run, "completed"), credits.release(reservation.id), credits.settle(reservation.id)]);
      expect(await moneyOf(bob.id)).toEqual(before);
      expect(before.reservations).toEqual([["settled", "1.000000", "0.000035"]]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("an identical replay of the run's usage returns the first entry (no second debit); a conflicting one is a 409 and writes nothing", async () => {
      const { bob, request } = await seed();
      script.push("call");
      fake.enqueue({ content: "answer", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await engine.collect(request);
      const before = await moneyOf(bob.id);
      const [entry] = await usageEntries();
      const record = {
        reservationId: (await reservationRows())[0].id,
        memberUserId: bob.id,
        requestId: entry.requestId ?? "",
        callId: entry.callId ?? "",
        runId: entry.runId ?? undefined,
        agentId: entry.agentId ?? undefined,
        parentCallId: null,
        modelId: entry.modelId ?? "",
        tier: entry.tier ?? "",
        rates: { rateNew: new Decimal(2), rateCached: new Decimal(1), rateOut: new Decimal(3) },
        tokens: { tokensNew: entry.tokensNew ?? 0, tokensCached: entry.tokensCached ?? 0, tokensOut: entry.tokensOut ?? 0 },
        outcome: entry.outcome ?? "completed",
      };
      const replays = await Promise.all([credits.recordUsage(record), credits.recordUsage(record)]);
      expect(replays.map((r) => r.id)).toEqual([entry.id, entry.id]);
      await expect(credits.recordUsage({ ...record, tokens: { ...record.tokens, tokensOut: record.tokens.tokensOut + 1 } })).rejects.toBeInstanceOf(ConflictException);
      expect(await moneyOf(bob.id)).toEqual(before);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC7: settings", () => {
    it.each(MODES)("%s: no per-run cap setting rows: the meter's existing cap policy applies (a hold of 10 credits on a 12-credit wallet)", async (mode) => {
      const { bob, request } = await seed({ credits: "12" });
      script.push("call");
      fake.enqueue({ content: "answer", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await runIn(mode, request);
      expect((await moneyOf(bob.id)).reservations).toEqual([["settled", "10.000000", "0.000035"]]);
    });

    it.each(MODES)("%s: the model's tier has no rate row: the existing 400 before any hold or call", async (mode) => {
      await prisma.tierRate.deleteMany();
      await moduleRef.get(ModelRegistryService).refresh();
      const { bob, request } = await seed();
      script.push("call");
      const { error } = await failIn(mode, request);
      expect((error as Error).message).toBe('No credit rates found for model "test-model"');
      expect(fake.requests).toHaveLength(0);
      expect(await moneyOf(bob.id)).toEqual({ balance: "1.000000", held: "0.000000", reservations: [], entries: [] });
    });
  });
});
