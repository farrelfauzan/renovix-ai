import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
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
import { OpenRouterAdapter } from "../../providers/openrouter.adapter";
import { ProviderAttemptDeadlineError } from "../../providers/errors/provider-attempt-deadline-error";
import type { ChatRequest } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { CHAT_ENGINE_AGENT_NOT_CALLABLE, CHAT_ENGINE_PEER_UNAVAILABLE } from "../../chat-engine/config/chat-engine.config";
import { CALLED_AGENT_DOCUMENT_NOTE } from "../config/called-agent-document-note";
import { PEER_CALL_MESSAGES } from "../config/peer-call-messages";
import { budgetStopMessage } from "../utils/budget-stop-message";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { setRunCap } from "../../../../test/run-cap";
import { setPeerRunLimits } from "../../../../test/peer-run-limits";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-121b-1: the peer-call runtime of an agent run (call_agent). A called agent runs as a full agent on the chat
// engine (its own prompt and model, its tools on the runner's connections, its knowledge and memory, the guardrails,
// only its task) on the run's one reservation; the limits come from the platform settings (non-default values here);
// every hop gets a child run (RNX-302). Real AgentRunService, AgentToolService, run policy, meter, ledger and provider
// router on the test database; fake LLM provider (AC4 hands the called agent's call to the real adapter over a stalled
// fetch). Agents are told apart by their prompts ("PROMPT A" ...). These collaborators load ESM-only packages.
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

type Usage = { prompt_tokens: number; completion_tokens: number };

describe("RNX-121b-1: agent calls in an agent run (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const memoryOf = new Map<string, string>();
  const getMemoryContext = jest.fn(async (agentId: string) => memoryOf.get(agentId) ?? "");
  const extractAndStore = jest.fn(async () => undefined);
  const getUserConnectedProviders = jest.fn(async () => new Map());
  const generateWithStorage = jest.fn();
  const canSearchKnowledgeBase = jest.fn(async () => true);
  const searchKnowledgeBase = jest.fn(async (knowledgeBaseId: string) => [{ content: `KNOWLEDGE OF ${knowledgeBaseId}` }]);
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
          { provide: DocumentService, useValue: { generateWithStorage } },
          { provide: AgentMemoryService, useValue: { getMemoryContext, extractAndStore } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: { canSearchKnowledgeBase, searchKnowledgeBase } },
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
    memoryOf.clear();
    jest.clearAllMocks();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits.
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A subscribed user funded with `credits`. */
  const payingUser = async (credits = "1") => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, credits);
    return user;
  };

  /** The owner's workspace with active agents named "Agent <X>" (prompt "PROMPT <X>") and the links given as "AB" (A may call B). */
  const seed = async ({ agents = ["A", "B"], links = ["AB"], credits = "1" }: { agents?: string[]; links?: string[]; credits?: string } = {}) => {
    const owner = await payingUser(credits);
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const byName: Record<string, Awaited<ReturnType<typeof createAgent>>> = {};
    for (const name of agents) {
      byName[name] = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: `Agent ${name}`, systemPrompt: `PROMPT ${name}`, status: "active", maxTokens: 100 });
    }
    for (const [caller, callee] of links) {
      await prisma.agentLink.create({ data: { callerAgentId: byName[caller].id, calleeAgentId: byName[callee].id } });
    }
    return { owner, workspace, A: byName.A, B: byName.B, C: byName.C };
  };

  const call = (agent: string, task: string, usage: Usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
    toolCalls: [{ name: "call_agent", arguments: { agent, task } }],
    usage,
  });
  const answer = (content: string, usage: Usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({ content, usage });
  /** Which agent a request is from: its prompt names it. */
  const agentOf = (request: ChatRequest) => /PROMPT (\w)/.exec(String(request.messages[0].content))?.[1];
  const requestsOf = (name: string) => fake.requests.filter((request) => agentOf(request) === name);
  const toolResults = (request: ChatRequest) => (request.messages as { role: string; content: string }[]).filter((m) => m.role === "tool").map((m) => m.content);
  const toolNames = (request: ChatRequest) => (request.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);
  const hops = () =>
    prisma.agentRun.findMany({
      where: { parentRunId: { not: null } },
      orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
  const usageEntries = () => prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
  const runMessages = async (runId: string) =>
    (await prisma.agentMessage.findMany({ where: { runId }, orderBy: { createdAt: "asc" } })).map((m) => [m.role, m.content]);

  describe("AC1: A calls B", () => {
    it("B runs with its own prompt, model, tools (the runner's connections), knowledge and memory, and only its task; its approved answer is A's tool result and A answers; one completed child run at depth 1; B's usage entries carry A's calling call", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      await createResolvableModel(prisma, { slug: "callee-model", modelName: "callee-model", maxTokens: 8192 });
      await moduleRef.get(ModelRegistryService).refresh();
      const { owner, workspace, A, B } = await seed();
      await prisma.agent.update({ where: { id: B.id }, data: { model: "callee-model" } });
      await prisma.agentTool.create({ data: { agentId: B.id, toolType: "calculator" } });
      const knowledgeBase = await prisma.knowledgeBase.create({ data: { userId: owner.id, workspaceId: workspace.id, name: "B's KB" } });
      await prisma.agentKnowledgeBase.create({ data: { agentId: B.id, knowledgeBaseId: knowledgeBase.id } });
      memoryOf.set(B.id, "B REMEMBERS TEA");
      fake.enqueue(call("Agent B", "summarise the notes"), answer("B answer"), answer("A final"));

      const result = await service.chat(owner.id, A.id, "Hi from the user");

      expect(result.message.content).toBe("A final");
      expect(fake.requests.map(agentOf)).toEqual(["A", "B", "A"]);
      const [bRequest] = requestsOf("B");
      expect([bRequest.model, bRequest.connection.slug, bRequest.connection.fallbacks, bRequest.singleAttemptTimeoutMs]).toEqual(["callee-model", "callee-model", [], 30_000]);
      expect(bRequest.messages).toEqual([
        { role: "system", content: `PROMPT B\n\n## Relevant Knowledge\nKNOWLEDGE OF ${knowledgeBase.id}\n\n## About This User\nB REMEMBERS TEA` },
        { role: "user", content: 'Task from agent "Agent A": summarise the notes' },
      ]);
      expect(toolNames(bRequest)).toEqual(["calculator", "create_document"]);
      expect(getUserConnectedProviders.mock.calls).toEqual([[owner.id, workspace.id], [owner.id, workspace.id]]);
      expect(canSearchKnowledgeBase).toHaveBeenCalledWith(owner.id, expect.objectContaining({ id: knowledgeBase.id }));
      expect(checkInput).toHaveBeenCalledWith('Task from agent "Agent A": summarise the notes', owner.id, B.id);
      expect(checkOutput).toHaveBeenCalledWith("B answer", owner.id, B.id);
      expect(extractAndStore.mock.calls).toEqual([[A.id, owner.id, "Hi from the user", "A final", "inside"]]);
      expect(toolResults(fake.requests[2])).toEqual(["B answer"]);
      const entries = await usageEntries();
      const [reservation] = await prisma.creditReservation.findMany();
      expect(entries.map((e) => [e.agentId, e.parentCallId, e.runId, e.memberUserId, e.outcome])).toEqual([
        [A.id, null, reservation.runId, owner.id, "completed"],
        [B.id, entries[0].callId, reservation.runId, owner.id, "completed"],
        [A.id, null, reservation.runId, owner.id, "completed"],
      ]);
      const [hop] = await hops();
      expect(await hops()).toHaveLength(1);
      expect([hop.agentId, hop.parentRunId, hop.depth, hop.status, hop.parentCallId, hop.userId]).toEqual([B.id, result.runId, 1, "completed", entries[0].callId, owner.id]);
      expect(hop.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", 'Task from agent "Agent A": summarise the notes'],
        ["assistant", "B answer"],
      ]);
      expect(await runMessages(result.runId)).toEqual([
        ["user", "Hi from the user"],
        ["assistant", "A final"],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC2: a cycle is refused", () => {
    it("A -> B and B -> A: B's call to A is refused as a cycle, no model call is made for it, a refused child row is written, and B answers without it", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 3, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A, B } = await seed({ links: ["AB", "BA"] });
      fake.enqueue(call("Agent B", "ask around"), call("Agent A", "back to you"), answer("B alone"), answer("A final"));

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A final");
      expect(fake.requests.map(agentOf)).toEqual(["A", "B", "B", "A"]);
      expect(toolResults(requestsOf("B")[1])).toEqual([PEER_CALL_MESSAGES.cycle]);
      expect(toolResults(fake.requests[3])).toEqual(["B alone"]);
      const [bHop, aHop] = await hops();
      expect([bHop.agentId, bHop.parentRunId, bHop.depth, bHop.status]).toEqual([B.id, result.runId, 1, "completed"]);
      expect([aHop.agentId, aHop.parentRunId, aHop.depth, aHop.status, aHop.durationMs]).toEqual([A.id, bHop.id, 2, "refused", 0]);
      expect(aHop.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", 'Task from agent "Agent B": back to you'],
        ["assistant", PEER_CALL_MESSAGES.cycle],
      ]);
      expect((await usageEntries()).map((e) => e.agentId)).toEqual([A.id, B.id, B.id, A.id]);
    });
  });

  describe("AC3: the depth and agent-call limits (platform settings)", () => {
    it("peerRunMaxDepth 1 and A -> B -> C: C is never called, a refused child row is written for the call, and B answers without it", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A, B, C } = await seed({ agents: ["A", "B", "C"], links: ["AB", "BC"] });
      fake.enqueue(call("Agent B", "go deeper"), call("Agent C", "deepest"), answer("B alone"), answer("A final"));

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A final");
      expect(fake.requests.map(agentOf)).toEqual(["A", "B", "B", "A"]);
      expect(requestsOf("C")).toEqual([]);
      expect(toolResults(requestsOf("B")[1])).toEqual([PEER_CALL_MESSAGES.depthLimit]);
      const [bHop, cHop] = await hops();
      expect([bHop.agentId, bHop.depth, bHop.status]).toEqual([B.id, 1, "completed"]);
      expect([cHop.agentId, cHop.parentRunId, cHop.depth, cHop.status]).toEqual([C.id, bHop.id, 2, "refused"]);
      expect((await usageEntries()).map((e) => e.agentId)).not.toContain(C.id);
    });

    it("peerRunMaxDepth 2 (control): the same chain calls C", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 2, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A } = await seed({ agents: ["A", "B", "C"], links: ["AB", "BC"] });
      fake.enqueue(call("Agent B", "go deeper"), call("Agent C", "deepest"), answer("C answer"), answer("B answer"), answer("A final"));

      await service.chat(owner.id, A.id, "Hi");

      expect(fake.requests.map(agentOf)).toEqual(["A", "B", "C", "B", "A"]);
      expect((await hops()).map((h) => [h.depth, h.status])).toEqual([
        [1, "completed"],
        [2, "completed"],
      ]);
    });

    it("peerRunMaxAgentCalls 1 reached: the next call is refused (no model call) and a refused child row is written for it", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 1, callTimeoutSeconds: 30 });
      const { owner, A, B } = await seed();
      fake.enqueue(
        { toolCalls: [{ name: "call_agent", arguments: { agent: "Agent B", task: "first" } }, { name: "call_agent", arguments: { agent: "Agent B", task: "second" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        answer("B first answer"),
        answer("A final"),
      );

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A final");
      expect(fake.requests.map(agentOf)).toEqual(["A", "B", "A"]);
      expect(toolResults(fake.requests[2])).toEqual(["B first answer", PEER_CALL_MESSAGES.agentCallLimit]);
      expect((await hops()).map((h) => [h.agentId, h.parentRunId, h.depth, h.status, h.messages[0].content])).toEqual([
        [B.id, result.runId, 1, "completed", 'Task from agent "Agent A": first'],
        [B.id, result.runId, 1, "refused", 'Task from agent "Agent A": second'],
      ]);
    });
  });

  describe("AC4: the per-call timeout (peerRunCallTimeoutSeconds)", () => {
    it("a called agent's model call that never answers is aborted after 1 s (the setting): one attempt, not the adapter's own timeout or retries; A gets an error result and continues; the child row is timeout", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 1 });
      const { owner, A, B } = await seed();
      const adapter = new OpenRouterAdapter(new ConfigService());
      const chat = fake.chat.bind(fake);
      const sentToAdapter: ChatRequest[] = [];
      jest.spyOn(fake, "chat").mockImplementation(async (request: ChatRequest) => {
        if (agentOf(request) !== "B") return chat(request);
        sentToAdapter.push(request);
        return adapter.chat(request);
      });
      const fetchSignals: AbortSignal[] = [];
      const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
        const signal = init!.signal!;
        fetchSignals.push(signal);
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      });
      const timeouts = jest.spyOn(AbortSignal, "timeout");
      fake.enqueue(call("Agent B", "slow work"), answer("A goes on"));
      const startedAt = Date.now();

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
      expect(result.message.content).toBe("A goes on");
      expect(sentToAdapter.map((r) => [r.singleAttemptTimeoutMs, r.connection.fallbacks])).toEqual([[1_000, []]]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSignals[0].aborted).toBe(true);
      expect(timeouts.mock.calls).toEqual([[1_000]]);
      expect(toolResults(fake.requests[1])).toEqual([`Error: ${new ProviderAttemptDeadlineError().message}`]);
      const [hop] = await hops();
      expect([hop.agentId, hop.depth, hop.status]).toEqual([B.id, 1, "timeout"]);
      expect(hop.durationMs).toBeGreaterThanOrEqual(1_000);
      expect((await usageEntries()).map((e) => [e.agentId, e.outcome, e.amount.toFixed(6)])).toEqual([
        [A.id, "completed", "-0.000015"],
        [B.id, "provider_error", "0.000000"],
        [A.id, "completed", "-0.000015"],
      ]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC5: a budget stop inside a chain ends the whole run", () => {
    it.each([
      ["the per-run cap (0.01)", "1", "0.993980"],
      ["the runner's paid wallet (0.01 available)", "0.01", "0.003980"],
    ])("%s: A -> B -> C stops where C's call would exceed the hold; the ledger has exactly the calls that ran, the reservation is settled, the balance stays at or above 0", async (_limit, credits, expectedBalance) => {
      await setPeerRunLimits(prisma, { maxDepth: 2, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A, B, C } = await seed({ agents: ["A", "B", "C"], links: ["AB", "BC"], credits });
      if (credits === "1") await setRunCap(prisma, 0.01);
      // C's E_call (its prompt + max_tokens 4,096) no longer fits under 0.01 once A and B have spent 3,010 each.
      await prisma.agent.update({ where: { id: C.id }, data: { maxTokens: 4_096 } });
      fake.enqueue(call("Agent B", "go", { prompt_tokens: 3_000, completion_tokens: 10 }), call("Agent C", "go on", { prompt_tokens: 3_000, completion_tokens: 10 }));

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe(budgetStopMessage(new Decimal("0.01")));
      expect(fake.requests.map(agentOf)).toEqual(["A", "B"]);
      expect((await usageEntries()).map((e) => [e.agentId, e.outcome, e.amount.toFixed(6)])).toEqual([
        [A.id, "completed", "-0.003010"],
        [B.id, "completed", "-0.003010"],
      ]);
      const [reservation] = await prisma.creditReservation.findMany();
      expect([reservation.status, reservation.amountHeld.toFixed(6), reservation.consumed.toFixed(6)]).toEqual(["settled", "0.010000", "0.006020"]);
      const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: owner.id, wallet: "paid" } } });
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual([expectedBalance, "0.000000"]);
      expect(account.balance.isNegative()).toBe(false);
      const [bHop, cHop] = await hops();
      expect([bHop.agentId, bHop.depth, bHop.status]).toEqual([B.id, 1, "budget_stopped"]);
      expect([cHop.agentId, cHop.parentRunId, cHop.depth, cHop.status]).toEqual([C.id, bHop.id, 2, "budget_stopped"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC6: every model call of a run is metered", () => {
    it("A -> B -> C: every call, root and nested, has a usage entry with its agent, the run, its parent call (null only for the root's) and the runner; the hops are written under their parents", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 2, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A, B, C } = await seed({ agents: ["A", "B", "C"], links: ["AB", "BC"] });
      fake.enqueue(call("Agent B", "go"), call("Agent C", "go on"), answer("C answer"), answer("B answer"), answer("A final"));

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A final");
      const entries = await usageEntries();
      const [reservation] = await prisma.creditReservation.findMany();
      expect(entries).toHaveLength(fake.requests.length);
      expect(entries.map((e) => [e.agentId, e.parentCallId, e.runId, e.memberUserId, e.outcome])).toEqual([
        [A.id, null, reservation.runId, owner.id, "completed"],
        [B.id, entries[0].callId, reservation.runId, owner.id, "completed"],
        [C.id, entries[1].callId, reservation.runId, owner.id, "completed"],
        [B.id, entries[0].callId, reservation.runId, owner.id, "completed"],
        [A.id, null, reservation.runId, owner.id, "completed"],
      ]);
      expect((await hops()).map((h) => [h.agentId, h.depth, h.status, h.parentCallId])).toEqual([
        [B.id, 1, "completed", entries[0].callId],
        [C.id, 2, "completed", entries[1].callId],
      ]);
      const [bHop, cHop] = await hops();
      expect([bHop.parentRunId, cHop.parentRunId]).toEqual([result.runId, bHop.id]);
      expect(reservation.status).toBe("settled");
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC7: who may be called", () => {
    it("a public agent A with links, run by a non-member: no call is made and no child run exists", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { A } = await seed();
      await prisma.agent.update({ where: { id: A.id }, data: { isPublic: true } });
      const stranger = await payingUser();
      fake.enqueue(call("Agent B", "do it"), answer("A alone"));

      const result = await service.chat(stranger.id, A.id, "Hi");

      expect(result.message.content).toBe("A alone");
      expect(toolNames(fake.requests[0])).not.toContain("call_agent");
      expect(fake.requests.map(agentOf)).toEqual(["A", "A"]);
      expect(toolResults(fake.requests[1])).toEqual([CHAT_ENGINE_AGENT_NOT_CALLABLE]);
      expect(await hops()).toEqual([]);
    });

    it.each([
      ["paused (not active)", { status: "draft" }],
      ["deleted", { deletedAt: new Date() }],
    ])("B linked from A is %s: A's model calls B by name, the call is refused, nothing runs, no child row is written", async (_state, change) => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      // A also calls an active C, so call_agent stays offered and the refusal is the link check's.
      const { owner, A, B } = await seed({ agents: ["A", "B", "C"], links: ["AB", "AC"] });
      await prisma.agent.update({ where: { id: B.id }, data: change });
      fake.enqueue(call("Agent B", "do it"), answer("A alone"));

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A alone");
      expect(toolNames(fake.requests[0])).toContain("call_agent");
      expect(fake.requests.map(agentOf)).toEqual(["A", "A"]);
      expect(toolResults(fake.requests[1])).toEqual([CHAT_ENGINE_AGENT_NOT_CALLABLE]);
      expect(await hops()).toEqual([]);
      expect((await usageEntries()).map((e) => e.agentId)).toEqual([A.id, A.id]);
    });
  });

  describe("AC11: a missing limit setting", () => {
    it("the peerRunMaxDepth row deleted: the call returns the unavailable result, no model call is made for it, a refused child row is written, a log line names the setting, and A continues", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      await prisma.platformSetting.deleteMany({ where: { name: "peerRunMaxDepth" } });
      const { owner, A, B } = await seed();
      fake.enqueue(call("Agent B", "do it"), answer("A goes on"));
      const { lines } = captureLogLines();

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A goes on");
      expect(fake.requests.map(agentOf)).toEqual(["A", "A"]);
      expect(toolResults(fake.requests[1])).toEqual([CHAT_ENGINE_PEER_UNAVAILABLE]);
      expect((await hops()).map((h) => [h.agentId, h.parentRunId, h.depth, h.status])).toEqual([[B.id, result.runId, 1, "refused"]]);
      expect(lines.filter((line) => line.includes("peerRunMaxDepth"))).toEqual([expect.stringContaining("Agent call unavailable: the platform setting peerRunMaxDepth is not set")]);
    });
  });

  describe("AC12: call_agent the run did not offer", () => {
    it("A has no links: the model's call_agent is refused, no model call and no child run happen, and the run continues", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A } = await seed({ links: [] });
      fake.enqueue(call("Agent B", "do it"), answer("A alone"));

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(result.message.content).toBe("A alone");
      expect(toolNames(fake.requests[0])).not.toContain("call_agent");
      expect(fake.requests.map(agentOf)).toEqual(["A", "A"]);
      expect(toolResults(fake.requests[1])).toEqual([CHAT_ENGINE_AGENT_NOT_CALLABLE]);
      expect(await hops()).toEqual([]);
    });
  });

  describe("AC13: called agents' timeouts and aborts do not trip the provider's circuit breaker", () => {
    it.each([
      ["timed out (its own deadline)", () => new ProviderAttemptDeadlineError(), "timeout"],
      // An Error named AbortError: Jest's sandbox has its own Error, so a DOMException is not `instanceof Error` here.
      ["aborted", () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "error"],
    ] as const)("6 called-agent calls %s in a row (over the breaker's 5): the breaker stays closed, another user's call to the same provider is served by it, and no called-agent call moved to the fallback model", async (_kind, failure, status) => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 6, callTimeoutSeconds: 30 });
      const fallback = await createResolvableModel(prisma, { slug: "fallback-model", modelName: "fallback-model", maxTokens: 8192 });
      const primary = await prisma.aiModel.findFirstOrThrow({ where: { slug: "test-model" } });
      await prisma.aiModelFallback.create({ data: { modelId: primary.id, fallbackModelId: fallback.model.id, position: 0 } });
      await moduleRef.get(ModelRegistryService).refresh();
      const { owner, A } = await seed();
      const chat = fake.chat.bind(fake);
      const calleeRequests: ChatRequest[] = [];
      jest.spyOn(fake, "chat").mockImplementation(async (request: ChatRequest) => {
        if (agentOf(request) !== "B") return chat(request);
        calleeRequests.push(request);
        throw failure();
      });
      const sixCalls = Array.from({ length: 6 }, (_, i) => ({ name: "call_agent", arguments: { agent: "Agent B", task: `try ${i}` } }));
      fake.enqueue({ toolCalls: sixCalls, usage: { prompt_tokens: 10, completion_tokens: 5 } }, answer("A final"));
      const carol = await payingUser();
      const carolWorkspace = await createWorkspace(prisma, { ownerId: carol.id });
      const carolAgent = await createAgent(prisma, { userId: carol.id, workspaceId: carolWorkspace.id, systemPrompt: "PROMPT D", status: "active" });

      const result = await service.chat(owner.id, A.id, "Hi");
      fake.enqueue(answer("Carol served"));
      const carolResult = await service.chat(carol.id, carolAgent.id, "Hello");

      expect(result.message.content).toBe("A final");
      expect(calleeRequests).toHaveLength(6);
      expect(calleeRequests.map((r) => [r.connection.slug, r.connection.fallbacks])).toEqual(Array(6).fill(["test-model", []]));
      expect((await hops()).map((h) => h.status)).toEqual(Array(6).fill(status));
      expect(carolResult.message.content).toBe("Carol served");
      expect(fake.requests.map((r) => r.connection.slug)).toEqual(["test-model", "test-model", "test-model"]);
    });
  });

  describe("AC14: a client disconnect during a chain", () => {
    it("A calls B (finished) and then C (running) when the client disconnects: the run is aborted, B's child row is completed, C's is error, both under A's run", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A, B, C } = await seed({ agents: ["A", "B", "C"], links: ["AB", "AC"] });
      const controller = new AbortController();
      const chat = fake.chat.bind(fake);
      jest.spyOn(fake, "chat").mockImplementation((request: ChatRequest) => {
        if (agentOf(request) !== "C") return chat(request);
        return new Promise((_resolve, reject) => {
          request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true });
          controller.abort();
        });
      });
      fake.enqueue(
        { toolCalls: [{ name: "call_agent", arguments: { agent: "Agent B", task: "first" } }, { name: "call_agent", arguments: { agent: "Agent C", task: "second" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        answer("B answer"),
      );

      await expect(service.chat(owner.id, A.id, "Hi", undefined, { signal: controller.signal })).rejects.toThrow();

      expect(fake.requests.map(agentOf)).toEqual(["A", "B"]);
      const top = await prisma.agentRun.findFirstOrThrow({ where: { parentRunId: null } });
      expect((await hops()).map((h) => [h.agentId, h.parentRunId, h.depth, h.status])).toEqual([
        [B.id, top.id, 1, "completed"],
        [C.id, top.id, 1, "error"],
      ]);
      expect(await runMessages(top.id)).toEqual([["user", "Hi"]]);
      expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["settled"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC15: create_document in a called agent's run", () => {
    it("no document is created; its output is text that goes back to the called agent, whose answer is the caller's tool result", async () => {
      await setPeerRunLimits(prisma, { maxDepth: 1, maxAgentCalls: 3, callTimeoutSeconds: 30 });
      const { owner, A, B } = await seed();
      fake.enqueue(
        call("Agent B", "write the Q3 report"),
        { toolCalls: [{ name: "create_document", arguments: { content: "# Q3 report\n\nAll good.", format: "pdf" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        answer("Here is the report as text: # Q3 report All good."),
        answer("A final"),
      );

      const result = await service.chat(owner.id, A.id, "Hi");

      expect(generateWithStorage).not.toHaveBeenCalled();
      expect(toolNames(requestsOf("B")[0])).toContain("create_document");
      expect(toolResults(requestsOf("B")[1])).toEqual([`${CALLED_AGENT_DOCUMENT_NOTE}\n\n# Q3 report\n\nAll good.`]);
      expect(toolResults(fake.requests[3])).toEqual(["Here is the report as text: # Q3 report All good."]);
      expect(result.document).toBeNull();
      expect((await hops()).map((h) => [h.agentId, h.status])).toEqual([[B.id, "completed"]]);
    });
  });
});
