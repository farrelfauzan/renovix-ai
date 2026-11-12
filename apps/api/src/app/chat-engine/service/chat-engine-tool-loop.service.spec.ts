import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatEngineService } from "./chat-engine.service";
import { ChatEngineMeterService } from "./chat-engine-meter.service";
import { ChatEngineToolLoop } from "./chat-engine-tool-loop.service";
import { CHAT_ENGINE_LOOP_PROFILES } from "../config/chat-engine-loop-profiles";
import { CHANNEL_CHAT_CONTINUE_PROMPT } from "../../channel/config/channel-chat-continue-prompt";
import { CHAT_ENGINE_PEER_UNAVAILABLE } from "../config/chat-engine.config";
import { EMPTY_CHAT_ENGINE_RESULT } from "../config/empty-chat-engine-result";
import { UNAVAILABLE_PEER_CALL } from "../config/unavailable-peer-call";
import { applyChatEngineEvent } from "../utils/apply-chat-engine-event";
import type { ChatEngineEvent } from "../types/chat-engine-event";
import type { ChatEngineLoopProfile } from "../types/chat-engine-loop-profile";
import type { ChatEngineResult } from "../types/chat-engine-result";
import type { ChatEngineRunOptions } from "../types/chat-engine-run-options";
import type { ChatExchangeRecord } from "../types/chat-exchange-record";
import type { OutputApproval } from "../types/output-approval";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { RunBudgetStoppedError } from "../../agent/errors/run-budget-stopped.error";
import { budgetStopMessage } from "../../agent/utils/budget-stop-message";
import type { RunScope } from "../../agent/types/run-scope";
import { FakeProviderAdapter, type FakeTurn } from "../../providers/fake.adapter";
import type { ChatRequest, ChatResponse } from "../../providers/provider.interface";

// RNX-283: the tool loop as the engine's execution, without a database: real ChatEngineService, ChatEngineMeterService
// (its AgentRunMeterService and model registry are doubles that call the fake provider), ChatEngineToolLoop and
// AgentToolService (its MCP, web search, memory and document collaborators are doubles), the empty peer port. The money
// paths on the real ledger are in chat-engine.tool-loop.db.spec.ts. These collaborators load ESM-only packages.
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./chat-engine-context.service", () => ({ ChatEngineContextService: class {} }));
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const MODES = [["streamed"], ["collected"]] as const;
type Mode = (typeof MODES)[number][0];
const LOOP_SOURCES = [["agent-run"], ["channel-chat"], ["reminder"]] as const;
type LoopSource = (typeof LOOP_SOURCES)[number][0];
const SOURCES_IN_MODES = LOOP_SOURCES.flatMap(([source]) => MODES.map(([mode]) => [source, mode] as const));
const notAvailable = (name: string) => `Tool "${name}" is not available. It may require an MCP integration to be connected.`;
/** Non-default agent settings, so the request is seen to carry the agent's own. */
const AGENT_TEMPERATURE = 0.3;
const AGENT_MAX_TOKENS = 321;

type Setup = {
  source?: string;
  toolTypes?: string[];
  offered?: string[];
  turns?: FakeTurn[];
  scope?: RunScope;
  history?: { role: "user" | "assistant"; content: string }[];
  approve?: (raw: string) => OutputApproval;
};

function setup(options: Setup = {}) {
  const runnerUserId = randomUUID();
  const fake = new FakeProviderAdapter(options.turns ?? []);
  const connection = { slug: "test-model", baseUrl: "http://provider.invalid/v1", apiKey: "fake-key", providerName: "fake" };
  const agent = {
    id: randomUUID(),
    workspaceId: randomUUID(),
    model: "test-model",
    systemPrompt: `prompt-${randomUUID()}`,
    temperature: AGENT_TEMPERATURE,
    maxTokens: AGENT_MAX_TOKENS,
    tools: (options.toolTypes ?? []).map((toolType) => ({ toolType, enabled: true })),
    knowledgeBases: [],
  };
  const held = new Decimal("0.5");
  const budget = { runId: randomUUID(), reservationId: randomUUID(), runnerUserId, held, spent: new Decimal(0) };
  const runMeter = {
    openRun: jest.fn(async () => budget),
    callModel: jest.fn(async (_run: unknown, call: { request: ChatRequest }) => ({ response: await fake.chat(call.request), callId: randomUUID() })),
    closeRun: jest.fn(async () => undefined),
  };
  const registry = { resolveModel: jest.fn(async () => ({ slug: "test-model" })), resolveConnection: jest.fn(async () => connection) };
  const meter = new ChatEngineMeterService(runMeter as never, registry as never);
  const webSearch = { search: jest.fn() };
  const memory = { storeExplicit: jest.fn(), extractAndStore: jest.fn() };
  const mcpClient = { connect: jest.fn(), close: jest.fn() };
  const workspaces = { findDefaultFlag: jest.fn(async () => ({ isDefault: false })) };
  const mcpUsers = { getUserConnectedProviders: jest.fn(async () => new Map()) };
  const tools = new AgentToolService(mcpClient as never, {} as never, mcpUsers as never, webSearch as never, memory as never, {} as never, {} as never, {} as never, workspaces as never, {} as never);
  const peers = { callPeer: jest.fn(UNAVAILABLE_PEER_CALL.callPeer) };
  const loop = new ChatEngineToolLoop(tools, peers);
  const scope = options.scope ?? "inside";
  const agents = { findAgentForRun: jest.fn(async () => agent) };
  const policy = { decideRun: jest.fn(async () => ({ allowed: true, scope })) };
  const guardrail = { checkInput: jest.fn(async () => ({ blocked: false })) };
  const contexts = {
    buildContext: jest.fn(async (request: { offeredTools: unknown[] }) => ({ scope, memory: "", knowledge: "", offeredTools: request.offeredTools })),
  };
  const outputApproval = {
    approveOutput: jest.fn(async (raw: string): Promise<OutputApproval> => options.approve?.(raw) ?? { status: "approved", content: raw }),
    approveToolResult: jest.fn(async (content: string): Promise<OutputApproval> => ({ status: "approved", content })),
  };
  const persistence = { saveExchange: jest.fn(async (_record: ChatExchangeRecord) => undefined), handToMemory: jest.fn(async (_record: ChatExchangeRecord) => undefined) };
  const engine = new ChatEngineService(agents as never, policy as never, guardrail as never, contexts as never, meter, loop, outputApproval as never, persistence as never);
  const request = (input = "Hi", history = options.history ?? []) => ({
    principal: { runnerUserId },
    source: options.source ?? "agent-run",
    conversation: { agentId: agent.id, history },
    input,
    options: { offeredTools: (options.offered ?? []).map((name) => ({ name })) },
  });
  const runIn = async (mode: Mode, runOptions: ChatEngineRunOptions = {}, body: unknown = request()): Promise<{ result: ChatEngineResult; events: ChatEngineEvent[] }> => {
    if (mode === "collected") return { result: await engine.collect(body, runOptions), events: [] };
    const events: ChatEngineEvent[] = [];
    let result = EMPTY_CHAT_ENGINE_RESULT;
    for await (const event of engine.run(body, runOptions)) {
      events.push(event);
      result = applyChatEngineEvent(result, event);
    }
    return { result, events };
  };
  const failIn = async (mode: Mode, runOptions: ChatEngineRunOptions = {}, body: unknown = request()): Promise<unknown> => {
    try {
      await runIn(mode, runOptions, body);
    } catch (error) {
      return error;
    }
    throw new Error("the run did not fail");
  };
  const toolNamesSent = (index: number) => (fake.requests[index].tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);
  const lastMessage = (index: number) => fake.requests[index].messages.at(-1);
  const executeTool = jest.spyOn(tools, "executeTool");
  const cleanup = jest.spyOn(tools, "cleanupMcpConnections");
  return { engine, request, runIn, failIn, fake, agent, runnerUserId, runMeter, budget, held, tools, peers, webSearch, memory, outputApproval, persistence, executeTool, cleanup, toolNamesSent, lastMessage };
}

/** Replaces one source's profile fields for the test (restored by jest.restoreAllMocks). */
const withProfile = (source: LoopSource, fields: Partial<ChatEngineLoopProfile>) =>
  jest.replaceProperty(CHAT_ENGINE_LOOP_PROFILES, source, { ...CHAT_ENGINE_LOOP_PROFILES[source]!, ...fields });

/** Makes the fake's next `chat` answers pass through `change` (the fake itself never answers "length" or without a choice). */
const reshapeAnswers = (fake: FakeProviderAdapter, ...changes: ((response: ChatResponse) => ChatResponse)[]) => {
  const chat = fake.chat.bind(fake);
  const spy = jest.spyOn(fake, "chat");
  for (const change of changes) spy.mockImplementationOnce(async (params) => change(await chat(params)));
};
const cutAtLength = (response: ChatResponse): ChatResponse => ({ ...response, choices: [{ ...response.choices[0], finish_reason: "length" }] });
const withoutChoice = (response: ChatResponse): ChatResponse => ({ ...response, choices: [] });
const toolTurn = (...calls: { id?: string; name: string; arguments: object | string }[]): FakeTurn => ({ toolCalls: calls });

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("RNX-283: the chat engine's tool loop (fake provider, no database)", () => {
  describe("AC1: answers, tool calls and unknown or unoffered tools", () => {
    it.each(MODES)("%s: a plain answer: one call with the agent's prompt, settings and no tools; the answer is approved and stored", async (mode) => {
      const t = setup({ turns: [{ content: "Plain answer" }] });
      const { result, events } = await t.runIn(mode);
      expect([result.status, result.content]).toEqual(["completed", "Plain answer"]);
      if (mode === "streamed") expect(events.map((e) => e.type)).toEqual(["context", "content", "done"]);
      expect(t.fake.requests).toHaveLength(1);
      expect(t.fake.requests[0]).toMatchObject({
        messages: [{ role: "system", content: t.agent.systemPrompt }, { role: "user", content: "Hi" }],
        temperature: AGENT_TEMPERATURE,
        max_tokens: AGENT_MAX_TOKENS,
      });
      expect([t.fake.requests[0].tools, t.fake.requests[0].tool_choice]).toEqual([undefined, undefined]);
      expect(t.persistence.saveExchange.mock.calls[0][0]).toMatchObject({ approvedInput: "Hi", approvedOutput: "Plain answer" });
      expect(t.runMeter.closeRun).toHaveBeenCalledWith(t.budget, "completed");
    });

    it.each(MODES)("%s: a tool call with its follow-up: the offered tool runs, its result goes back to the model and out as a tool_result", async (mode) => {
      const t = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [toolTurn({ id: "c1", name: "calculator", arguments: { expression: "6*7" } }), { content: "It is 42" }] });
      const { result, events } = await t.runIn(mode);
      expect([result.content, result.toolResults]).toEqual(["It is 42", [{ toolName: "calculator", content: "Result: 42" }]]);
      if (mode === "streamed") expect(events.map((e) => e.type)).toEqual(["context", "tool_result", "content", "done"]);
      expect([t.toolNamesSent(0), t.fake.requests[0].tool_choice]).toEqual([["calculator"], "auto"]);
      expect(t.lastMessage(1)).toEqual({ role: "tool", tool_call_id: "c1", content: "Result: 42" });
      expect(t.fake.requests).toHaveLength(2);
      expect(t.cleanup).toHaveBeenCalledTimes(1);
    });

    it.each(MODES)("%s: several tool calls in one reply run in order in one round, then the model answers", async (mode) => {
      const t = setup({
        toolTypes: ["calculator"],
        offered: ["calculator"],
        turns: [toolTurn({ id: "a", name: "calculator", arguments: { expression: "1+1" } }, { id: "b", name: "calculator", arguments: { expression: "2*5" } }), { content: "Done" }],
      });
      const { result } = await t.runIn(mode);
      expect(result.toolResults).toEqual([{ toolName: "calculator", content: "Result: 2" }, { toolName: "calculator", content: "Result: 10" }]);
      expect(t.fake.requests[1].messages.slice(-2)).toEqual([
        { role: "tool", tool_call_id: "a", content: "Result: 2" },
        { role: "tool", tool_call_id: "b", content: "Result: 10" },
      ]);
      expect(t.fake.requests).toHaveLength(2);
    });

    it.each(MODES)("%s: tools offered but no tool call: the tools are sent, nothing runs, the answer ends the loop", async (mode) => {
      const t = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [{ content: "No tool needed" }] });
      const { result } = await t.runIn(mode);
      expect([result.content, result.toolResults]).toEqual(["No tool needed", []]);
      expect(t.toolNamesSent(0)).toEqual(["calculator"]);
      expect(t.executeTool).not.toHaveBeenCalled();
    });

    it.each(SOURCES_IN_MODES)("%s, %s: an unknown name, a tool of the agent the request does not offer, and code_exec run nothing; each gets 'not available'", async (source, mode) => {
      const t = setup({
        source,
        toolTypes: ["calculator", "web_search", "code_exec"],
        offered: ["calculator", "code_exec", "create_document"],
        turns: [
          toolTurn({ id: "u", name: "send_email", arguments: {} }, { id: "w", name: "web_search", arguments: { query: "x" } }, { id: "c", name: "code_exec", arguments: { code: "1" } }),
          { content: "Final" },
        ],
      });
      const { result } = await t.runIn(mode);
      expect(result.content).toBe("Final");
      expect(t.toolNamesSent(0)).toEqual(["calculator", "create_document"]);
      expect(t.fake.requests[1].messages.slice(-3)).toEqual([
        { role: "tool", tool_call_id: "u", content: notAvailable("send_email") },
        { role: "tool", tool_call_id: "w", content: notAvailable("web_search") },
        { role: "tool", tool_call_id: "c", content: notAvailable("code_exec") },
      ]);
      expect(t.webSearch.search).not.toHaveBeenCalled();
      // The engine accepts tool results of offered names only: code_exec is in the request's list, its refusal text comes out.
      expect(result.toolResults).toEqual([{ toolName: "code_exec", content: notAvailable("code_exec") }]);
    });
  });

  describe("AC2: a malformed call, a failing tool and a timed-out tool give an error result; no timer is left", () => {
    beforeEach(() => jest.useFakeTimers());

    it.each(MODES)("%s: malformed arguments: the model gets the 'Error: …' result, no tool runs, the loop goes on; no timer left", async (mode) => {
      const t = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [toolTurn({ id: "m", name: "calculator", arguments: "{not json" }), { content: "Recovered" }] });
      const { result } = await t.runIn(mode);
      expect(result.content).toBe("Recovered");
      expect(t.lastMessage(1)).toEqual({ role: "tool", tool_call_id: "m", content: expect.stringMatching(/^Error: .*JSON/) });
      expect(t.executeTool).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each(MODES)("%s: a failing tool: 'Error: <message>'; a later call to a tool that is not offered still runs nothing", async (mode) => {
      const t = setup({
        toolTypes: ["calculator", "web_search"],
        offered: ["calculator"],
        turns: [toolTurn({ id: "f", name: "calculator", arguments: { expression: "1" } }), toolTurn({ id: "w", name: "web_search", arguments: { query: "q" } }), { content: "After failure" }],
      });
      t.executeTool.mockRejectedValueOnce(new Error("tool broke"));
      const { result } = await t.runIn(mode);
      expect(result.content).toBe("After failure");
      expect(t.lastMessage(1)).toEqual({ role: "tool", tool_call_id: "f", content: "Error: tool broke" });
      expect(t.lastMessage(2)).toEqual({ role: "tool", tool_call_id: "w", content: notAvailable("web_search") });
      expect(t.webSearch.search).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each(MODES)("%s: a tool that never answers: after the tool timeout the model gets 'Error: Tool execution timeout'; the timer is gone", async (mode) => {
      const t = setup({ toolTypes: ["web_search"], offered: ["web_search"], turns: [toolTurn({ id: "s", name: "web_search", arguments: { query: "q" } }), { content: "Without search" }] });
      t.webSearch.search.mockReturnValue(new Promise(() => undefined));
      const running = t.runIn(mode);
      for (let tick = 0; tick < 1000 && jest.getTimerCount() === 0; tick++) await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(30_000);
      const { result } = await running;
      expect(result.content).toBe("Without search");
      expect(t.lastMessage(1)).toEqual({ role: "tool", tool_call_id: "s", content: "Error: Tool execution timeout" });
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each(MODES)("%s: RNX-276 retained: a tool that answers in time leaves no pending timeout timer", async (mode) => {
      const t = setup({ toolTypes: ["web_search"], offered: ["web_search"], turns: [toolTurn({ id: "s", name: "web_search", arguments: { query: "q" } }), { content: "With search" }] });
      t.webSearch.search.mockResolvedValue("search results");
      const { result } = await t.runIn(mode);
      expect(result.toolResults).toEqual([{ toolName: "web_search", content: "search results" }]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("AC3: limits, abort, disconnect and the budget stop end the loop: no further provider call, the meter closes the run once", () => {
    it.each(SOURCES_IN_MODES)("%s, %s: a non-default limit of 2 rounds: 2 provider calls, then the source's own max-steps answer", async (source, mode) => {
      withProfile(source, { maxIterations: 2 });
      const t = setup({ source, toolTypes: ["calculator"], offered: ["calculator"], turns: [1, 2, 3].map((i) => toolTurn({ name: "calculator", arguments: { expression: `${i}` } })) });
      const { result } = await t.runIn(mode);
      expect(result.content).toBe(CHAT_ENGINE_LOOP_PROFILES[source]!.maxStepsMessage);
      expect(t.fake.requests).toHaveLength(2);
      expect(t.outputApproval.approveOutput).toHaveBeenCalledWith(CHAT_ENGINE_LOOP_PROFILES[source]!.maxStepsMessage, t.runnerUserId, t.agent.id);
      expect(t.runMeter.closeRun.mock.calls).toEqual([[t.budget, "completed"]]);
    });

    it.each(MODES)("%s: an abort during a tool: the round's next tool and the next model call never run; failed, nothing stored", async (mode) => {
      const controller = new AbortController();
      const t = setup({
        toolTypes: ["calculator"],
        offered: ["calculator"],
        turns: [toolTurn({ id: "a", name: "calculator", arguments: { expression: "1" } }, { id: "b", name: "calculator", arguments: { expression: "2" } }), { content: "never" }],
      });
      t.executeTool.mockImplementationOnce(async () => {
        controller.abort();
        return "first";
      });
      const error = await t.failIn(mode, { signal: controller.signal });
      expect((error as Error).name).toBe("AbortError");
      expect(t.executeTool).toHaveBeenCalledTimes(1);
      expect(t.fake.requests).toHaveLength(1);
      expect(t.runMeter.closeRun.mock.calls).toEqual([[t.budget, "failed"]]);
      expect([t.outputApproval.approveOutput.mock.calls.length, t.persistence.saveExchange.mock.calls.length]).toEqual([0, 0]);
      expect(t.cleanup).toHaveBeenCalledTimes(1);
    });

    it("disconnect at the first tool_result: the round's next tool and the next model call never run; closed once, MCP cleaned, nothing stored", async () => {
      const t = setup({
        toolTypes: ["calculator"],
        offered: ["calculator"],
        turns: [toolTurn({ id: "a", name: "calculator", arguments: { expression: "1" } }, { id: "b", name: "calculator", arguments: { expression: "2" } }), { content: "never" }],
      });
      for await (const event of t.engine.run(t.request())) if (event.type === "tool_result") break;
      expect(t.executeTool).toHaveBeenCalledTimes(1);
      expect(t.fake.requests).toHaveLength(1);
      expect(t.runMeter.closeRun.mock.calls).toEqual([[t.budget, "failed"]]);
      expect(t.cleanup).toHaveBeenCalledTimes(1);
      expect(t.persistence.saveExchange).not.toHaveBeenCalled();
    });

    it.each(MODES)("%s: the budget stop at the second call: no provider call for it, the stop message is approved and stored", async (mode) => {
      const t = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [toolTurn({ name: "calculator", arguments: { expression: "1" } }), { content: "never" }] });
      const callModel = t.runMeter.callModel.getMockImplementation()!;
      t.runMeter.callModel.mockImplementationOnce(callModel).mockRejectedValueOnce(new RunBudgetStoppedError(t.held));
      const { result } = await t.runIn(mode);
      expect(result.content).toBe(budgetStopMessage(t.held));
      expect(t.fake.requests).toHaveLength(1);
      expect(t.runMeter.closeRun.mock.calls).toEqual([[t.budget, "budget_stopped"]]);
      expect(t.persistence.saveExchange.mock.calls[0][0].approvedOutput).toBe(budgetStopMessage(t.held));
    });

    it.each(MODES)("%s: a budget stop raised inside a tool call (the peer port) is not swallowed into a tool result: the run stops at its budget", async (mode) => {
      const t = setup({ turns: [toolTurn({ name: "call_agent", arguments: { agent: "B", task: "t" } }), { content: "never" }] });
      t.peers.callPeer.mockRejectedValueOnce(new RunBudgetStoppedError(t.held));
      const { result } = await t.runIn(mode);
      expect(result.content).toBe(budgetStopMessage(t.held));
      expect(t.fake.requests).toHaveLength(1);
      expect(t.runMeter.closeRun.mock.calls).toEqual([[t.budget, "budget_stopped"]]);
    });
  });

  describe("AC4: the output approval runs before anything is stored; only approved output is stored and reaches the next history", () => {
    it.each(MODES.flatMap(([mode]) => (["approved", "transformed", "blocked"] as const).map((status) => [mode, status] as const)))(
      "%s, %s: the approval sees the raw answer first; the stored and emitted answer is its content; memory only when not blocked",
      async (mode, status) => {
        const raw = `raw-${randomUUID()}`;
        const approved = status === "approved" ? raw : `${status}-${randomUUID()}`;
        const t = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [toolTurn({ name: "calculator", arguments: { expression: "1" } }), { content: raw }], approve: () => ({ status, content: approved }) });
        const { result, events } = await t.runIn(mode);
        expect(result.content).toBe(approved);
        expect(t.outputApproval.approveOutput).toHaveBeenCalledWith(raw, t.runnerUserId, t.agent.id);
        expect(t.outputApproval.approveOutput.mock.invocationCallOrder[0]).toBeLessThan(t.persistence.saveExchange.mock.invocationCallOrder[0]);
        expect(t.persistence.saveExchange.mock.calls[0][0].approvedOutput).toBe(approved);
        expect(t.persistence.handToMemory).toHaveBeenCalledTimes(status === "blocked" ? 0 : 1);
        if (status !== "approved") expect(JSON.stringify([events, result, t.persistence.saveExchange.mock.calls, t.persistence.handToMemory.mock.calls])).not.toContain(raw);
        expect(t.memory.extractAndStore).not.toHaveBeenCalled();
      },
    );

    it.each(MODES)("%s: a budget-stop answer goes through the approval too; a blocked one is stored as the safe text, not memorised", async (mode) => {
      const t = setup({ approve: () => ({ status: "blocked", content: "safe text" }) });
      t.runMeter.callModel.mockRejectedValueOnce(new RunBudgetStoppedError(t.held));
      const { result } = await t.runIn(mode);
      expect([result.status, result.content]).toEqual(["blocked", "safe text"]);
      expect(t.outputApproval.approveOutput).toHaveBeenCalledWith(budgetStopMessage(t.held), t.runnerUserId, t.agent.id);
      expect(t.persistence.saveExchange.mock.calls[0][0].approvedOutput).toBe("safe text");
      expect(t.persistence.handToMemory).not.toHaveBeenCalled();
    });

    it.each(MODES)("%s: the next run's history is built from the stored exchange: the raw answer of a blocked run never reaches the model again", async (mode) => {
      const raw = `raw-${randomUUID()}`;
      const t = setup({ turns: [{ content: raw }, { content: "second" }], approve: (answer) => (answer === raw ? { status: "blocked", content: "safe text" } : { status: "approved", content: answer }) });
      await t.runIn(mode);
      const stored = t.persistence.saveExchange.mock.calls[0][0];
      const history = [
        { role: "user" as const, content: stored.approvedInput ?? "" },
        { role: "assistant" as const, content: stored.approvedOutput },
      ];
      await t.runIn(mode, {}, t.request("Again", history));
      expect(t.fake.requests[1].messages).toEqual([{ role: "system", content: t.agent.systemPrompt }, ...history, { role: "user", content: "Again" }]);
      expect(JSON.stringify(t.fake.requests[1])).not.toContain(raw);
    });
  });

  describe("AC5: the empty peer port", () => {
    it.each(SOURCES_IN_MODES)("%s, %s: a call_agent attempt calls no agent and no model; the model gets the 'unavailable' result; call_agent is never offered", async (source, mode) => {
      const t = setup({ source, toolTypes: ["calculator"], offered: ["calculator", "call_agent"], turns: [toolTurn({ id: "p", name: "call_agent", arguments: { agent: "B", task: "t" } }), { content: "Alone" }] });
      const { result } = await t.runIn(mode);
      expect(result.content).toBe("Alone");
      expect(t.toolNamesSent(0)).toEqual(["calculator"]);
      // RNX-25 (D341 D1): the peer request also carries the run's scope, the calling call (its parent) and the metered call.
      const [firstCall] = t.runMeter.callModel.mock.results;
      const parentCallId = (await firstCall.value).callId;
      expect(t.peers.callPeer.mock.calls).toEqual([[{ runnerUserId: t.runnerUserId, agentId: t.agent.id, args: { agent: "B", task: "t" }, scope: "inside", parentCallId, callModel: expect.any(Function) }]]);
      expect(t.lastMessage(1)).toEqual({ role: "tool", tool_call_id: "p", content: CHAT_ENGINE_PEER_UNAVAILABLE });
      expect(t.executeTool).not.toHaveBeenCalled();
      expect(t.fake.requests).toHaveLength(2);
    });
  });

  describe("RNX-25 (D341 D1): the opt-in engine changes, off unless the request or the caller asks", () => {
    const callTurn = () => toolTurn({ id: "p", name: "call_agent", arguments: { agent: "B", task: "t" } });

    it.each(MODES)("%s: offersCallAgent offers call_agent; without it (same agent, same offered list) it is not offered", async (mode) => {
      const asked = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [{ content: "ok" }] });
      const notAsked = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [{ content: "ok" }] });
      const body = asked.request();
      await asked.runIn(mode, {}, { ...body, options: { ...body.options, offersCallAgent: true } });
      await notAsked.runIn(mode);
      expect(asked.toolNamesSent(0)).toEqual(["calculator", "call_agent"]);
      expect(notAsked.toolNamesSent(0)).toEqual(["calculator"]);
    });

    it.each(MODES)("%s: offersAgentTools offers every tool the agent has without listing it (create_document is always built); without it an unlisted tool is not offered", async (mode) => {
      const asked = setup({ toolTypes: ["calculator"], turns: [{ content: "ok" }] });
      const notAsked = setup({ toolTypes: ["calculator"], turns: [{ content: "ok" }] });
      const body = asked.request();
      await asked.runIn(mode, {}, { ...body, options: { ...body.options, offersAgentTools: true } });
      await notAsked.runIn(mode);
      expect(asked.toolNamesSent(0)).toEqual(["calculator", "create_document"]);
      expect(notAsked.toolNamesSent(0)).toEqual([]);
    });

    it.each(MODES)("%s: the caller's mcpSession is the run's: its offered names are set and it is closed once", async (mode) => {
      const t = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [{ content: "ok" }] });
      const mcpSession = { connections: [], toolConnections: new Map(), offeredToolNames: new Set<string>(), document: null };
      await t.runIn(mode, { mcpSession });
      expect([...mcpSession.offeredToolNames]).toEqual(["calculator"]);
      expect(t.cleanup.mock.calls).toEqual([[mcpSession]]);
    });

    it.each(MODES)("%s: a hop's call through the peer request is metered on the run against the called agent's connection, with the calling call as parent", async (mode) => {
      const t = setup({ turns: [callTurn(), { content: "B says hi" }, { content: "Done" }] });
      const calleeConnection = { slug: "callee-model", baseUrl: "http://provider.invalid/v1", apiKey: "fake-key", providerName: "fake" };
      t.peers.callPeer.mockImplementation(async (request) => {
        const hop = { agentId: "callee-agent", connection: calleeConnection, parentCallId: request.parentCallId };
        const { response } = await request.callModel({ messages: [{ role: "user", content: "t" }], max_tokens: 50 }, hop);
        return response.choices[0].message.content ?? "";
      });
      const body = t.request();
      const { result } = await t.runIn(mode, {}, { ...body, options: { ...body.options, offersCallAgent: true } });
      const [rootCall, hopCall] = t.runMeter.callModel.mock.calls.map(([, call]) => call as { agentId: string; parentCallId: string | null; request: ChatRequest });
      const rootCallId = (await t.runMeter.callModel.mock.results[0].value).callId;
      expect(result.content).toBe("Done");
      expect([rootCall.agentId, rootCall.parentCallId, rootCall.request.connection.slug]).toEqual([t.agent.id, null, "test-model"]);
      expect([hopCall.agentId, hopCall.parentCallId, hopCall.request.connection.slug, hopCall.request.model]).toEqual(["callee-agent", rootCallId, "callee-model", "callee-model"]);
      expect(t.runMeter.openRun).toHaveBeenCalledTimes(1);
    });

    it.each(MODES)("%s: the reservation counts the caller's linked agents (none by default), and onReserved runs once, after the reservation and before the first call", async (mode) => {
      const linked = [{ model: "test-model", systemPrompt: "B", maxTokens: 10 }];
      const order: string[] = [];
      const t = setup({ toolTypes: ["calculator"], offered: ["calculator"], turns: [toolTurn({ name: "calculator", arguments: { expression: "1" } }), { content: "ok" }] });
      const plain = setup({ turns: [{ content: "ok" }] });
      t.runMeter.openRun.mockImplementation(async () => (order.push("reserved"), t.budget));
      const callModel = t.runMeter.callModel.getMockImplementation()!;
      t.runMeter.callModel.mockImplementation(async (run, call) => (order.push("call"), callModel(run, call)));
      await t.runIn(mode, { linkedAgents: linked, onReserved: async () => void order.push("onReserved") });
      await plain.runIn(mode);
      expect(order).toEqual(["reserved", "onReserved", "call", "call"]);
      expect((t.runMeter.openRun.mock.calls[0] as unknown[])[0]).toMatchObject({ linkedAgents: linked });
      expect((plain.runMeter.openRun.mock.calls[0] as unknown[])[0]).toMatchObject({ linkedAgents: [] });
    });

    it.each(MODES)("%s: each call returns its charge, what the run's spent grew by", async (mode) => {
      const t = setup({ turns: [{ content: "ok" }] });
      const charges: string[] = [];
      const callModel = t.runMeter.callModel.getMockImplementation()!;
      t.runMeter.callModel.mockImplementation(async (run, call) => {
        const metered = await callModel(run, call);
        t.budget.spent = t.budget.spent.plus("0.000042");
        return metered;
      });
      const execute = jest.spyOn(ChatEngineToolLoop.prototype, "execute").mockImplementation(async function* (input) {
        const metered = await input.callModel({ messages: [{ role: "user", content: input.approvedInput }], max_tokens: 10 });
        charges.push(metered.charge.toFixed(6));
        yield { type: "text", text: "ok" };
      });
      await t.runIn(mode);
      execute.mockRestore();
      expect(charges).toEqual(["0.000042"]);
    });
  });

  describe("AC6: per-source legacy behaviour is kept (RNX-16 index)", () => {
    it.each(MODES)("%s: rounds: the agent run counts a call_agent attempt 3, the channel chat and the reminder 1 (limit 4)", async (mode) => {
      const turns = () => [toolTurn({ name: "call_agent", arguments: { agent: "B", task: "t" } }), toolTurn({ name: "calculator", arguments: { expression: "1" } }), { content: "Third call" }];
      for (const source of ["agent-run", "channel-chat", "reminder"] as const) withProfile(source, { maxIterations: 4 });
      const ar = setup({ source: "agent-run", toolTypes: ["calculator"], offered: ["calculator"], turns: turns() });
      const ch = setup({ source: "channel-chat", toolTypes: ["calculator"], offered: ["calculator"], turns: turns() });
      const rm = setup({ source: "reminder", toolTypes: ["calculator"], offered: ["calculator"], turns: turns() });
      expect((await ar.runIn(mode)).result.content).toBe(CHAT_ENGINE_LOOP_PROFILES["agent-run"]!.maxStepsMessage);
      expect((await ch.runIn(mode)).result.content).toBe("Third call");
      expect((await rm.runIn(mode)).result.content).toBe("Third call");
      expect([ar.fake.requests.length, ch.fake.requests.length, rm.fake.requests.length]).toEqual([2, 3, 3]);
    });

    it.each(SOURCES_IN_MODES)("%s, %s: an answer cut at max_tokens: the channel chat asks to continue and joins the parts; the agent run and the reminder take it as final", async (source, mode) => {
      const t = setup({ source, turns: [{ content: "Part one. " }, { content: "Part two." }] });
      reshapeAnswers(t.fake, cutAtLength);
      const { result } = await t.runIn(mode);
      if (source !== "channel-chat") {
        expect([result.content, t.fake.requests.length]).toEqual(["Part one. ", 1]);
        return;
      }
      expect([result.content, t.fake.requests.length]).toEqual(["Part one. Part two.", 2]);
      expect(t.fake.requests[1].messages.slice(-2)).toEqual([
        { role: "assistant", content: "Part one. " },
        { role: "user", content: CHANNEL_CHAT_CONTINUE_PROMPT },
      ]);
    });

    it.each(MODES)("%s: the channel chat's continuations count as rounds: at its limit the max-steps answer replaces the joined parts", async (mode) => {
      withProfile("channel-chat", { maxIterations: 2 });
      const t = setup({ source: "channel-chat", turns: [{ content: "a " }, { content: "b " }, { content: "never" }] });
      reshapeAnswers(t.fake, cutAtLength, cutAtLength);
      const { result } = await t.runIn(mode);
      expect([result.content, t.fake.requests.length]).toEqual([CHAT_ENGINE_LOOP_PROFILES["channel-chat"]!.maxStepsMessage, 2]);
    });

    it.each(SOURCES_IN_MODES)("%s, %s: a tool result is cut for the channel chat and the reminder (non-default 12 characters), whole for the agent run", async (source, mode) => {
      withProfile(source, { toolResultMaxChars: source === "agent-run" ? null : 12 });
      const t = setup({ source, toolTypes: ["calculator"], offered: ["calculator"], turns: [toolTurn({ id: "k", name: "calculator", arguments: { expression: "123456789*1000" } }), { content: "ok" }] });
      const { result } = await t.runIn(mode);
      const expected = source === "agent-run" ? "Result: 123456789000" : "Result: 1234\n...[truncated]";
      expect(t.lastMessage(1)).toEqual({ role: "tool", tool_call_id: "k", content: expected });
      expect(result.toolResults).toEqual([{ toolName: "calculator", content: expected }]);
    });

    it("the default profiles carry the legacy values", () => {
      expect(Object.fromEntries(Object.entries(CHAT_ENGINE_LOOP_PROFILES).map(([source, p]) => [source, [p!.maxIterations, p!.agentCallExtraIterations, p!.continuesOnLength, p!.toolResultMaxChars, p!.throwsOnMissingChoice]]))).toEqual({
        "agent-run": [15, 2, false, null, true],
        "channel-chat": [30, 0, true, 4000, false],
        reminder: [15, 0, false, 4000, false],
      });
    });

    it.each(SOURCES_IN_MODES)("%s, %s: a response without a choice: the agent run fails (400 'No response from LLM', nothing stored); the channel chat and the reminder end with their max-steps answer", async (source, mode) => {
      const t = setup({ source, turns: [{ content: "ignored" }] });
      reshapeAnswers(t.fake, withoutChoice);
      if (source === "agent-run") {
        const error = await t.failIn(mode);
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as Error).message).toBe("No response from LLM");
        expect(t.runMeter.closeRun.mock.calls).toEqual([[t.budget, "failed"]]);
        expect(t.persistence.saveExchange).not.toHaveBeenCalled();
        return;
      }
      const { result } = await t.runIn(mode);
      expect(result.content).toBe(CHAT_ENGINE_LOOP_PROFILES[source]!.maxStepsMessage);
      expect(t.fake.requests).toHaveLength(1);
    });

    it.each(SOURCES_IN_MODES)("%s, %s: an empty answer is the (empty) raw answer for every source, approved before it is stored", async (source, mode) => {
      const t = setup({ source, turns: [{ content: "" }] });
      const { result } = await t.runIn(mode);
      expect(result.content).toBe("");
      expect(t.outputApproval.approveOutput).toHaveBeenCalledWith("", t.runnerUserId, t.agent.id);
    });

    it.each(MODES)("%s: the portal has no tool loop: refused before any model call or reservation, nothing stored", async (mode) => {
      const t = setup({ source: "portal", turns: [{ content: "never" }] });
      const error = await t.failIn(mode);
      expect((error as Error).message).toBe('The chat engine has no tool loop for the "portal" source');
      expect([t.fake.requests.length, t.runMeter.openRun.mock.calls.length, t.persistence.saveExchange.mock.calls.length]).toEqual([0, 0, 0]);
    });
  });

  describe("permissions and validation are kept", () => {
    it.each(MODES)("%s: a run outside the agent's workspace: memory_store is refused by the tool service and stores nothing", async (mode) => {
      const t = setup({ scope: "outside", toolTypes: ["memory_store"], offered: ["memory_store"], turns: [toolTurn({ id: "m", name: "memory_store", arguments: { fact: "f", type: "context" } }), { content: "ok" }] });
      await t.runIn(mode);
      expect(t.lastMessage(1)).toEqual({ role: "tool", tool_call_id: "m", content: "Memory is not available for this run." });
      expect(t.memory.storeExplicit).not.toHaveBeenCalled();
    });

    it("an invalid offered tool (empty name) is a ZodError before the agent is read or the loop runs", async () => {
      const t = setup({ turns: [{ content: "never" }] });
      await expect(t.engine.collect({ ...t.request(), options: { offeredTools: [{ name: "" }] } })).rejects.toThrow();
      expect([t.fake.requests.length, t.executeTool.mock.calls.length]).toEqual([0, 0]);
    });
  });
});
