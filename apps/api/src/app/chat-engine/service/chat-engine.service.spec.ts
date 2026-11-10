import { randomUUID } from "node:crypto";
import { ChatEngineService } from "./chat-engine.service";
import type { ChatEngineContext } from "../types/chat-engine-context";
import type { ChatEngineEvent } from "../types/chat-engine-event";
import type { ChatExecutionInput } from "../types/chat-execution-input";
import type { ChatExecutionChunk } from "../types/chat-execution-chunk";
import type { OutputApproval } from "../types/output-approval";
import type { RunDecision } from "../../agent/types/run-decision";
import type { GuardrailResult } from "../../guardrail/dto/guardrail-result.dto";

// RNX-281: the engine's orchestration with test doubles for every port and a fake execution (no provider, no database).
// RNX-282: the meter is a pass-through double here; the money paths are in chat-engine.credit-lifecycle.db.spec.ts.

type Setup = {
  runnerUserId?: string;
  decision?: RunDecision;
  agentExists?: boolean;
  verdict?: GuardrailResult;
  chunks?: ChatExecutionChunk[];
  outputApproval?: OutputApproval | ((raw: string) => OutputApproval);
  toolApproval?: (content: string) => OutputApproval;
  offeredToolNames?: string[];
};

function setup(options: Setup = {}) {
  const runnerUserId = options.runnerUserId ?? randomUUID();
  const agentId = randomUUID();
  const knowledgeBaseId = randomUUID();
  const scope = "outside" as const;
  const context: ChatEngineContext = {
    scope,
    memory: `memory-${randomUUID()}`,
    knowledge: `knowledge-${randomUUID()}`,
    offeredTools: (options.offeredToolNames ?? []).map((name) => ({ name, description: "" })),
  };
  const agents = { findAgentForRun: jest.fn().mockResolvedValue(options.agentExists === false ? null : { id: agentId, knowledgeBases: [{ knowledgeBaseId }] }) };
  const policy = { decideRun: jest.fn().mockResolvedValue(options.decision ?? { allowed: true, scope }) };
  const guardrail = { checkInput: jest.fn().mockResolvedValue(options.verdict ?? { blocked: false }) };
  const contexts = { buildContext: jest.fn().mockResolvedValue(context) };
  const execution = {
    execute: jest.fn(async function* (_input: ChatExecutionInput) {
      for (const chunk of options.chunks ?? []) yield chunk;
    }),
  };
  const outputApproval = {
    approveOutput: jest.fn(async (raw: string): Promise<OutputApproval> => {
      const approval = options.outputApproval ?? { status: "approved" as const, content: raw };
      return typeof approval === "function" ? approval(raw) : approval;
    }),
    approveToolResult: jest.fn(async (content: string): Promise<OutputApproval> => options.toolApproval?.(content) ?? { status: "approved", content }),
  };
  const meter = { meterExecution: jest.fn((_target: unknown, execute: (callModel: unknown) => AsyncIterable<ChatExecutionChunk>) => execute(jest.fn())) };
  const persistence = { saveExchange: jest.fn().mockResolvedValue(undefined), handToMemory: jest.fn().mockResolvedValue(undefined) };
  const engine = new ChatEngineService(agents as never, policy as never, guardrail as never, contexts as never, meter as never, execution as never, outputApproval as never, persistence as never);
  const request = (input: string) => ({
    principal: { runnerUserId },
    source: "agent-run",
    conversation: { agentId, history: [] },
    input,
    options: { offeredTools: (options.offeredToolNames ?? []).map((name) => ({ name })) },
  });
  return { engine, request, runnerUserId, agentId, knowledgeBaseId, context, agents, policy, guardrail, contexts, meter, execution, outputApproval, persistence };
}

async function streamEvents(events: AsyncIterable<ChatEngineEvent>): Promise<ChatEngineEvent[]> {
  const seen: ChatEngineEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

describe("ChatEngineService", () => {
  describe("AC1: streamed and collected are one path", () => {
    it("gives the same approved content, context and persisted record through run and collect", async () => {
      const rawText = `answer-${randomUUID()}`;
      const chunks: ChatExecutionChunk[] = [{ type: "text", text: rawText.slice(0, 3) }, { type: "text", text: rawText.slice(3) }];
      const t = setup({ chunks });
      const inputText = `hello-${randomUUID()}`;
      const events = await streamEvents(t.engine.run(t.request(inputText)));
      const result = await t.engine.collect(t.request(inputText));
      expect(events.map((event) => event.type)).toEqual(["context", "content", "done"]);
      expect(events).toContainEqual({ type: "content", status: "approved", content: rawText });
      expect(events[0]).toEqual({ type: "context", context: t.context });
      expect(result).toEqual({ status: "completed", reason: null, content: rawText, context: t.context, toolResults: [] });
      expect(t.persistence.saveExchange).toHaveBeenCalledTimes(2);
      const [streamedRecord, collectedRecord] = t.persistence.saveExchange.mock.calls.map((call) => call[0]);
      expect(streamedRecord).toEqual(collectedRecord);
      expect(streamedRecord).toMatchObject({ approvedInput: inputText, approvedOutput: rawText, context: t.context });
    });
  });

  describe("AC2: authorization", () => {
    it("allowed: the run goes through to a content event", async () => {
      const t = setup({ chunks: [{ type: "text", text: "ok" }] });
      const result = await t.engine.collect(t.request("hi"));
      expect(result.status).toBe("completed");
      expect(t.policy.decideRun).toHaveBeenCalledWith(expect.anything(), t.runnerUserId);
      expect(t.execution.execute).toHaveBeenCalledTimes(1);
      expect(t.persistence.saveExchange).toHaveBeenCalledTimes(1);
    });

    it.each([["not_runnable"], ["workspace_closed"], ["no_subscription"]] as const)(
      "denied (%s): no guardrail, no context, no execution, nothing persisted",
      async (reason) => {
        const t = setup({ decision: { allowed: false, reason }, chunks: [{ type: "text", text: "never" }] });
        const events = await streamEvents(t.engine.run(t.request("hi")));
        expect(events).toEqual([{ type: "denied", reason }]);
        expect(await t.engine.collect(t.request("hi"))).toEqual({ status: "denied", reason, content: null, context: null, toolResults: [] });
        expect(t.guardrail.checkInput).not.toHaveBeenCalled();
        expect(t.contexts.buildContext).not.toHaveBeenCalled();
        expect(t.meter.meterExecution).not.toHaveBeenCalled();
        expect(t.execution.execute).not.toHaveBeenCalled();
        expect(t.persistence.saveExchange).not.toHaveBeenCalled();
        expect(t.persistence.handToMemory).not.toHaveBeenCalled();
      },
    );

    it("an agent that does not exist is denied as not runnable, before the policy", async () => {
      const t = setup({ agentExists: false });
      const result = await t.engine.collect(t.request("hi"));
      expect([result.status, result.reason]).toEqual(["denied", "not_runnable"]);
      expect(t.policy.decideRun).not.toHaveBeenCalled();
      expect(t.execution.execute).not.toHaveBeenCalled();
      expect(t.persistence.saveExchange).not.toHaveBeenCalled();
    });

    it("a request that is not valid is refused before anything is read", async () => {
      const t = setup();
      await expect(t.engine.collect({ ...t.request("hi"), input: "" })).rejects.toThrow();
      await expect(t.engine.collect({ ...t.request("hi"), source: `other-${randomUUID()}` })).rejects.toThrow();
      expect(t.agents.findAgentForRun).not.toHaveBeenCalled();
    });
  });

  describe("AC3: input approval", () => {
    it("allowed: the input goes onward unchanged to the context search, the execution and the record", async () => {
      const t = setup();
      const inputText = `input-${randomUUID()}`;
      await t.engine.collect(t.request(inputText));
      expect(t.guardrail.checkInput).toHaveBeenCalledWith(inputText, t.runnerUserId, t.agentId);
      expect(t.contexts.buildContext.mock.calls[0][0].query).toBe(inputText);
      expect(t.execution.execute.mock.calls[0][0].approvedInput).toBe(inputText);
      expect(t.persistence.saveExchange.mock.calls[0][0].approvedInput).toBe(inputText);
    });

    it("transformed: only the sanitized input goes onward, the raw one reaches nothing", async () => {
      const rawInput = `raw-${randomUUID()}`;
      const sanitized = `clean-${randomUUID()}`;
      const t = setup({ verdict: { blocked: false, sanitized } });
      await t.engine.collect(t.request(rawInput));
      expect(t.contexts.buildContext.mock.calls[0][0].query).toBe(sanitized);
      expect(t.execution.execute.mock.calls[0][0].approvedInput).toBe(sanitized);
      expect(JSON.stringify(t.execution.execute.mock.calls)).not.toContain(rawInput);
      expect(t.persistence.saveExchange.mock.calls[0][0].approvedInput).toBe(sanitized);
      expect(JSON.stringify(t.persistence.saveExchange.mock.calls)).not.toContain(rawInput);
    });

    it("rejected: the decline is the answer; no context, no execution, no raw input stored, no memory", async () => {
      const rawInput = `bad-${randomUUID()}`;
      const userMessage = `decline-${randomUUID()}`;
      const t = setup({ verdict: { blocked: true, userMessage } });
      const events = await streamEvents(t.engine.run(t.request(rawInput)));
      expect(events).toEqual([{ type: "declined", message: userMessage }, { type: "done" }]);
      expect(t.contexts.buildContext).not.toHaveBeenCalled();
      expect(t.meter.meterExecution).not.toHaveBeenCalled();
      expect(t.execution.execute).not.toHaveBeenCalled();
      expect(t.persistence.saveExchange).toHaveBeenCalledTimes(1);
      expect(t.persistence.saveExchange.mock.calls[0][0]).toMatchObject({ approvedInput: null, approvedOutput: userMessage, context: null });
      expect(JSON.stringify(t.persistence.saveExchange.mock.calls)).not.toContain(rawInput);
      expect(t.persistence.handToMemory).not.toHaveBeenCalled();
    });
  });

  describe("AC4: runner identity", () => {
    it("a runner who is not the owner: the policy, guardrail, context, execution and persistence all get the runner", async () => {
      const runnerUserId = randomUUID();
      const t = setup({ runnerUserId, chunks: [{ type: "text", text: "ok" }] });
      await t.engine.collect(t.request("hi"));
      expect(t.policy.decideRun).toHaveBeenCalledWith(expect.anything(), runnerUserId);
      expect(t.guardrail.checkInput).toHaveBeenCalledWith(expect.anything(), runnerUserId, t.agentId);
      expect(t.contexts.buildContext.mock.calls[0][0]).toMatchObject({ runnerUserId, scope: "outside", agentId: t.agentId, knowledgeBaseIds: [t.knowledgeBaseId] });
      expect(t.execution.execute.mock.calls[0][0].principal).toEqual({ runnerUserId });
      expect(t.outputApproval.approveOutput).toHaveBeenCalledWith(expect.anything(), runnerUserId, t.agentId);
      expect(t.persistence.saveExchange.mock.calls[0][0].principal).toEqual({ runnerUserId });
      expect(t.persistence.handToMemory.mock.calls[0][0].principal).toEqual({ runnerUserId });
    });
  });

  describe("AC5: output and tool results", () => {
    it("transformed output: only the transformed text is persisted, handed to memory and emitted", async () => {
      const rawOutput = `raw-pii-${randomUUID()}`;
      const maskedOutput = `masked-${randomUUID()}`;
      const t = setup({ chunks: [{ type: "text", text: rawOutput }], outputApproval: { status: "transformed", content: maskedOutput } });
      const events = await streamEvents(t.engine.run(t.request("hi")));
      expect(events).toContainEqual({ type: "content", status: "transformed", content: maskedOutput });
      expect(t.persistence.saveExchange.mock.calls[0][0].approvedOutput).toBe(maskedOutput);
      expect(t.persistence.handToMemory.mock.calls[0][0].approvedOutput).toBe(maskedOutput);
      expect(JSON.stringify([events, t.persistence.saveExchange.mock.calls, t.persistence.handToMemory.mock.calls])).not.toContain(rawOutput);
    });

    it("blocked output: the safe text is persisted, the raw output is neither persisted nor handed to memory", async () => {
      const rawOutput = `dangerous-${randomUUID()}`;
      const safeText = `safe-${randomUUID()}`;
      const t = setup({ chunks: [{ type: "text", text: rawOutput }], outputApproval: { status: "blocked", content: safeText } });
      const result = await t.engine.collect(t.request("hi"));
      expect(result.status).toBe("blocked");
      expect(result.content).toBe(safeText);
      expect(t.persistence.saveExchange.mock.calls[0][0].approvedOutput).toBe(safeText);
      expect(JSON.stringify(t.persistence.saveExchange.mock.calls)).not.toContain(rawOutput);
      expect(t.persistence.handToMemory).not.toHaveBeenCalled();
    });

    it("a tool result: only a result of an offered tool that meets the contract and passes the approval is used, as approved", async () => {
      const offered = `tool-${randomUUID()}`;
      const notOffered = `other-${randomUUID()}`;
      const rawResult = `raw-result-${randomUUID()}`;
      const maskedResult = `masked-result-${randomUUID()}`;
      const blockedResult = `blocked-result-${randomUUID()}`;
      const t = setup({
        offeredToolNames: [offered],
        toolApproval: (content) => (content === blockedResult ? { status: "blocked", content: "" } : { status: "transformed", content: maskedResult }),
        chunks: [
          { type: "tool_result", toolName: offered, content: rawResult },
          { type: "tool_result", toolName: notOffered, content: rawResult },
          { type: "tool_result", toolName: offered, content: { not: "text" } },
          { type: "tool_result", toolName: offered, content: blockedResult },
          { type: "text", text: "final" },
        ],
      });
      const result = await t.engine.collect(t.request("hi"));
      expect(result.toolResults).toEqual([{ toolName: offered, content: maskedResult }]);
      expect(t.outputApproval.approveToolResult).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result)).not.toContain(rawResult);
    });
  });

  describe("RNX-283 (RNX-282 review): the abort checks before a save", () => {
    it("an abort while the output approval runs: the pre-save check stops the save and the memory handoff", async () => {
      const controller = new AbortController();
      const t = setup({
        chunks: [{ type: "text", text: "answer" }],
        outputApproval: (raw) => {
          controller.abort();
          return { status: "approved", content: raw };
        },
      });
      await expect(t.engine.collect(t.request("hi"), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
      expect(t.outputApproval.approveOutput).toHaveBeenCalledTimes(1);
      expect([t.persistence.saveExchange.mock.calls.length, t.persistence.handToMemory.mock.calls.length]).toEqual([0, 0]);
    });

    it("an abort while the input guardrail runs and then rejects the input: the decline is not saved", async () => {
      const controller = new AbortController();
      const t = setup();
      t.guardrail.checkInput.mockImplementationOnce(async () => {
        controller.abort();
        return { blocked: true, userMessage: "declined" };
      });
      const events: ChatEngineEvent["type"][] = [];
      await expect(
        (async () => {
          for await (const event of t.engine.run(t.request("hi"), { signal: controller.signal })) events.push(event.type);
        })(),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(events).toEqual([]);
      expect(t.persistence.saveExchange).not.toHaveBeenCalled();
    });
  });
});
