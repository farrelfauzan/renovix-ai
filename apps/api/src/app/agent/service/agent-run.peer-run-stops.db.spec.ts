import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderCircuitBreaker } from "../../providers/provider-circuit-breaker";
import type { ChatRequest, ChatResponse } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { CHAT_ENGINE_PEER_UNAVAILABLE } from "../../chat-engine/config/chat-engine.config";
import { PEER_RUN_SOCKET_MARGIN_MS } from "../config/peer-run-socket-margin-ms";
import { RunLimitStoppedError } from "../errors/run-limit-stopped.error";
import { budgetStopMessage } from "../utils/budget-stop-message";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setPeerRunLimits } from "../../../../test/peer-run-limits";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-326: the run limits of an agent run with agent calls (RNX-121b-1's runtime): the model-call cap
// (peerRunMaxModelCalls, root and hops together) and the run time limit (peerRunMaxMinutes, cut at the route's socket
// timeout minus PEER_RUN_SOCKET_MARGIN_MS); at either one the running model call is aborted, no further call starts and
// the run ends with the budget-stop answer, stop reason limit_stopped (settled). Real AgentRunService, run policy, meter,
// ledger and provider router on the test database; fake LLM provider; non-default limits. The run's stop timer is
// caught (catchRunTimer) and fired by the test while the model call it should abort is running: no real wait. Agents
// are told apart by their prompts ("PROMPT A" ...). These collaborators load ESM-only packages.
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

type Usage = { prompt_tokens: number; completion_tokens: number };
type CaughtTimer = { readonly delayMs: number; readonly fire: () => void };

/** How far below the expected run time limit the caught timer's delay may be (the time from the run's start to its first agent call). */
const TIMER_SLACK_MS = 5_000;
/** A stalled model call that is never aborted (a planted fault) answers its next scripted turn after this long, so the test fails on an assertion, not on Jest's timeout. */
const GUARD_MS = 2_000;

describe("RNX-326: the run limits of an agent run with agent calls (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const chat = fake.chat.bind(fake);
  const getMemoryContext = jest.fn(async () => "");
  const extractAndStore = jest.fn(async () => undefined);
  const getUserConnectedProviders = jest.fn(async () => new Map());
  const checkInput = jest.fn(async () => ({ blocked: false }));
  const checkOutput = jest.fn(async (content: string) => ({ blocked: false, content }));
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
          AgentToolService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: McpClientService, useValue: { connect: jest.fn(), close: jest.fn() } },
          { provide: McpService, useValue: {} },
          { provide: McpUserService, useValue: { getUserConnectedProviders } },
          { provide: WebSearchService, useValue: {} },
          { provide: DocumentService, useValue: { generateWithStorage: jest.fn() } },
          { provide: AgentMemoryService, useValue: { getMemoryContext, extractAndStore } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: { canSearchKnowledgeBase: jest.fn(async () => true), searchKnowledgeBase: jest.fn(async () => []) } },
          { provide: GuardrailService, useValue: { checkInput, checkOutput } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    // A test that stops early leaves scripted turns behind; none reaches the next test.
    (fake as unknown as { turns: unknown[] }).turns.length = 0;
    jest.clearAllMocks();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits.
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** The owner's workspace (funded with 1 credit) with active agents named "Agent <X>" (prompt "PROMPT <X>") and the links given as "AB" (A may call B). */
  const seed = async ({ agents = ["A", "B"], links = ["AB"] }: { agents?: string[]; links?: string[] } = {}) => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id });
    await fundPaidWallet(prisma, owner.id, "1");
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const byName: Record<string, Awaited<ReturnType<typeof createAgent>>> = {};
    for (const name of agents) {
      byName[name] = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: `Agent ${name}`, systemPrompt: `PROMPT ${name}`, status: "active", maxTokens: 100 });
    }
    for (const [caller, callee] of links) {
      await prisma.agentLink.create({ data: { callerAgentId: byName[caller].id, calleeAgentId: byName[callee].id } });
    }
    return { owner, workspace, A: byName.A, B: byName.B };
  };

  const call = (agent: string, task: string, usage: Usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
    toolCalls: [{ name: "call_agent", arguments: { agent, task } }],
    usage,
  });
  const calculator = (usage: Usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
    toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }],
    usage,
  });
  const answer = (content: string, usage: Usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({ content, usage });
  /** Which agent a request is from: its prompt names it. */
  const agentOf = (request: ChatRequest) => /PROMPT (\w)/.exec(String(request.messages[0].content))?.[1];
  const toolResults = (request: ChatRequest) => (request.messages as { role: string; content: string }[]).filter((m) => m.role === "tool").map((m) => m.content);
  const hops = () => prisma.agentRun.findMany({ where: { parentRunId: { not: null } }, orderBy: [{ depth: "asc" }, { createdAt: "asc" }] });
  const usageEntries = async () =>
    (await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } })).map((e) => [e.agentId, e.outcome, e.amount.toFixed(6)]);
  const runMessages = async (runId: string) =>
    (await prisma.agentMessage.findMany({ where: { runId }, orderBy: { createdAt: "asc" } })).map((m) => [m.role, m.content]);

  /**
   * The run's stop timer: a `setTimeout` whose delay is at most `limitMs` and within TIMER_SLACK_MS of it is caught
   * (not scheduled) and fired by the test; every other timer runs as usual.
   */
  const catchRunTimer = (limitMs: number): CaughtTimer[] => {
    const realSetTimeout = globalThis.setTimeout as unknown as (callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]) => unknown;
    const caught: CaughtTimer[] = [];
    jest.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delayMs?: number, ...args: unknown[]) => {
      if (delayMs === undefined || delayMs <= limitMs - TIMER_SLACK_MS || delayMs > limitMs) return realSetTimeout(callback, delayMs, ...args);
      caught.push({ delayMs, fire: callback });
      return undefined;
    }) as unknown as typeof setTimeout);
    return caught;
  };

  /**
   * A model call that ends only when its signal aborts (it rejects with the abort's reason, as the adapter's fetch does);
   * `onStart` runs once it listens. Never aborted (a planted fault), it answers its next scripted turn after GUARD_MS.
   */
  const stall = (request: ChatRequest, onStart: () => void): Promise<ChatResponse> =>
    new Promise((resolve, reject) => {
      const guard = setTimeout(() => resolve(chat(request)), GUARD_MS);
      request.signal?.addEventListener("abort", () => {
        clearTimeout(guard);
        reject(request.signal?.reason);
      }, { once: true });
      onStart();
    });

  describe("AC1: the model-call cap (peerRunMaxModelCalls)", () => {
    it("peerRunMaxModelCalls 3 and A -> B, where A's call and B's two calls reach it: A's next model call is not made, the run ends with the budget-stop answer and the stop reason limit_stopped; the ledger has exactly the 3 calls and the reservation is settled", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30, maxModelCalls: 3, maxMinutes: 2 });
      const { owner, A, B } = await seed();
      await prisma.agentTool.create({ data: { agentId: B.id, toolType: "calculator" } });
      const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");
      fake.enqueue(call("Agent B", "add it up"), calculator(), answer("B answer"), answer("A final"));

      const result = await service.chat(owner.id, A.id, "Hi");

      const [reservation] = await prisma.creditReservation.findMany();
      expect(result.message.content).toBe(budgetStopMessage(reservation.amountHeld));
      expect(fake.requests.map(agentOf)).toEqual(["A", "B", "B"]);
      expect(await usageEntries()).toEqual([
        [A.id, "completed", "-0.000015"],
        [B.id, "completed", "-0.000015"],
        [B.id, "completed", "-0.000015"],
      ]);
      expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000045"]);
      expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["limit_stopped"]);
      expect((await hops()).map((h) => [h.agentId, h.depth, h.status])).toEqual([[B.id, 1, "completed"]]);
      expect(await runMessages(result.runId)).toEqual([
        ["user", "Hi"],
        ["assistant", budgetStopMessage(reservation.amountHeld)],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });

    it("control: an agent without callable agents is not limited (as on main): peerRunMaxModelCalls 2 and A alone making 3 model calls answers, and no model call carries a run-limit signal", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30, maxModelCalls: 2, maxMinutes: 2 });
      const { owner, A } = await seed({ agents: ["A"], links: [] });
      await prisma.agentTool.create({ data: { agentId: A.id, toolType: "calculator" } });
      fake.enqueue(calculator(), calculator(), answer("A final"));

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A final");
      expect(fake.requests.map((r) => [agentOf(r), r.signal])).toEqual([
        ["A", undefined],
        ["A", undefined],
        ["A", undefined],
      ]);
    });
  });

  describe("AC2: the run time limit (peerRunMaxMinutes, cut at socketTimeoutMs minus the margin)", () => {
    it.each([
      ["socketTimeoutMs = margin + 45 s, smaller than peerRunMaxMinutes 2: the stop timer is set at most 45 s after the run's start, before socketTimeoutMs", PEER_RUN_SOCKET_MARGIN_MS + 45_000, 45_000],
      ["no socketTimeoutMs: the stop timer is set at most peerRunMaxMinutes (2 min) after the run's start", undefined, 120_000],
    ])("%s; it fires while B's model call runs: that call is aborted, no further call starts, B's child run is timeout, and the run ends with the budget-stop answer as limit_stopped (settled)", async (_case, socketTimeoutMs, expectedLimitMs) => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30, maxModelCalls: 10, maxMinutes: 2 });
      const { owner, A, B } = await seed();
      const runTimers = catchRunTimer(expectedLimitMs);
      const stalled: ChatRequest[] = [];
      jest.spyOn(fake, "chat").mockImplementation((request: ChatRequest) => {
        if (agentOf(request) !== "B") return chat(request);
        stalled.push(request);
        return stall(request, () => runTimers[0]?.fire());
      });
      const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");
      fake.enqueue(call("Agent B", "slow work"), answer("B too late"), answer("A goes on"));

      const result = await service.chat(owner.id, A.id, "Hi", undefined, { socketTimeoutMs });

      const [reservation] = await prisma.creditReservation.findMany();
      expect(result.message.content).toBe(budgetStopMessage(reservation.amountHeld));
      expect(runTimers).toHaveLength(1);
      expect(runTimers[0].delayMs).toBeLessThanOrEqual(expectedLimitMs);
      expect(fake.requests.map(agentOf)).toEqual(["A"]);
      expect(stalled.map(agentOf)).toEqual(["B"]);
      expect(stalled[0].signal?.aborted).toBe(true);
      expect(stalled[0].signal?.reason).toBeInstanceOf(RunLimitStoppedError);
      expect((await hops()).map((h) => [h.agentId, h.depth, h.status])).toEqual([[B.id, 1, "timeout"]]);
      expect(await usageEntries()).toEqual([
        [A.id, "completed", "-0.000015"],
        [B.id, "provider_error", "0.000000"],
      ]);
      expect(reservation.status).toBe("settled");
      expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["limit_stopped"]);
      expect(await runMessages(result.runId)).toEqual([
        ["user", "Hi"],
        ["assistant", budgetStopMessage(reservation.amountHeld)],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC3: the run time limit during the root's own model call", () => {
    it("A calls B (answered), then the limit fires while A's own model call runs: that call is aborted (the provider sees the abort signal), no further call starts, the run ends with the budget-stop answer as limit_stopped, and the circuit breaker records no failure for it", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30, maxModelCalls: 10, maxMinutes: 2 });
      const { owner, A, B } = await seed();
      const runTimers = catchRunTimer(120_000);
      const recordFailure = jest.spyOn(ProviderCircuitBreaker.prototype, "recordFailure");
      const recordSuccess = jest.spyOn(ProviderCircuitBreaker.prototype, "recordSuccess");
      const stalled: ChatRequest[] = [];
      jest.spyOn(fake, "chat").mockImplementation((request: ChatRequest) => {
        if (agentOf(request) !== "A" || fake.requests.length < 2) return chat(request);
        stalled.push(request);
        return stall(request, () => runTimers[0]?.fire());
      });
      const closeRun = jest.spyOn(moduleRef.get(AgentRunMeterService), "closeRun");
      fake.enqueue(call("Agent B", "quick"), answer("B answer"), answer("A too late"));

      const result = await service.chat(owner.id, A.id, "Hi");

      const [reservation] = await prisma.creditReservation.findMany();
      expect(result.message.content).toBe(budgetStopMessage(reservation.amountHeld));
      expect(fake.requests.map(agentOf)).toEqual(["A", "B"]);
      expect(stalled.map(agentOf)).toEqual(["A"]);
      expect(toolResults(stalled[0])).toEqual(["B answer"]);
      expect(stalled[0].signal?.aborted).toBe(true);
      expect(stalled[0].signal?.reason).toBeInstanceOf(RunLimitStoppedError);
      // The two answered calls reached the breaker (the connection has a provider record); the aborted one is no failure.
      expect(recordSuccess).toHaveBeenCalledTimes(2);
      expect(recordFailure).not.toHaveBeenCalled();
      expect((await hops()).map((h) => [h.agentId, h.status])).toEqual([[B.id, "completed"]]);
      expect(await usageEntries()).toEqual([
        [A.id, "completed", "-0.000015"],
        [B.id, "completed", "-0.000015"],
        [A.id, "provider_error", "0.000000"],
      ]);
      expect(reservation.status).toBe("settled");
      expect(closeRun.mock.calls.map(([, ending]) => ending)).toEqual(["limit_stopped"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC4: a missing run-limit setting", () => {
    // RNX-327: without peerRunMaxModelCalls the pre-run estimate counts no called agent and logs it too.
    it.each([
      ["peerRunMaxModelCalls", ["Pre-run estimate counts no called agent: the platform setting peerRunMaxModelCalls is not set"]],
      ["peerRunMaxMinutes", []],
    ])("the %s row deleted: A's call to B returns the unavailable result, no model call is made for it, a refused child row is written, a log line names the setting, and A continues", async (setting, estimateLines) => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30, maxModelCalls: 4, maxMinutes: 2 });
      await prisma.platformSetting.deleteMany({ where: { name: setting } });
      const { owner, A, B } = await seed();
      // The third turn is used only if B runs (B would take the second): then A's answer is "A after B".
      fake.enqueue(call("Agent B", "do it"), answer("A goes on"), answer("A after B"));
      const { lines } = captureLogLines();

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A goes on");
      expect(fake.requests.map(agentOf)).toEqual(["A", "A"]);
      expect(toolResults(fake.requests[1])).toEqual([CHAT_ENGINE_PEER_UNAVAILABLE]);
      expect((await hops()).map((h) => [h.agentId, h.parentRunId, h.depth, h.status])).toEqual([[B.id, result.runId, 1, "refused"]]);
      expect(lines.filter((line) => line.includes(setting))).toEqual([...estimateLines.map((line) => expect.stringContaining(line)), expect.stringContaining(`Agent call unavailable: the platform setting ${setting} is not set`)]);
    });
  });
});
