import { Injectable } from "@nestjs/common";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { CHAT_ENGINE_DEFAULT_DECLINE } from "../config/chat-engine.config";
import { EMPTY_CHAT_ENGINE_RESULT } from "../config/empty-chat-engine-result";
import { ChatEngineRequestSchema } from "../dto/chat-engine-request.dto";
import { ChatEngineToolResultSchema } from "../dto/chat-engine-tool-result.dto";
import { ChatEngineExecution } from "../ports/chat-engine-execution.port";
import { ChatEngineOutputApproval } from "../ports/chat-engine-output-approval.port";
import { ChatEnginePersistence } from "../ports/chat-engine-persistence.port";
import type { ChatEngineAgent } from "../types/chat-engine-agent";
import type { ChatEngineAuthorization } from "../types/chat-engine-authorization";
import type { ChatEngineContext } from "../types/chat-engine-context";
import type { ChatEngineEvent } from "../types/chat-engine-event";
import type { ChatEngineRequest } from "../types/chat-engine-request";
import type { ChatEngineResult } from "../types/chat-engine-result";
import type { ChatEngineRunOptions } from "../types/chat-engine-run-options";
import { applyChatEngineEvent } from "../utils/apply-chat-engine-event";
import { approveInput } from "../utils/approve-input";
import { toExchangeRecord } from "../utils/to-exchange-record";
import { toMeteredExecutionTarget } from "../utils/to-metered-execution-target";
import { ChatEngineContextService } from "./chat-engine-context.service";
import { ChatEngineMeterService } from "./chat-engine-meter.service";

/**
 * RNX-281: the typed orchestration core of the chat engine, on the existing ports only. One path for every mode:
 * `run` yields the events and `collect` folds the same stream, so a streamed and a collected run give the same approved
 * content and context. Order: validate the request (Zod), the run policy (AgentRunPolicyService.decideRun), the
 * input guardrail (GuardrailService.checkInput), the permitted context, the injected execution, the injected output
 * approval, then the persistence port. Nothing is persisted or executed for a denied request, and the raw model output
 * and the raw rejected input never leave this class. No production entrypoint uses it yet. RNX-282: the execution runs
 * inside ChatEngineMeterService, its only way to the model a call metered on the run's one reservation, closed once
 * however the run ends; a budget stop's message is the raw answer and goes through the output approval. An aborted
 * `signal` (ChatEngineRunOptions) stops the run, in-flight model work included, and nothing of it is persisted.
 */
@Injectable()
export class ChatEngineService {
  constructor(
    private readonly agents: AgentRepository,
    private readonly policy: AgentRunPolicyService,
    private readonly guardrail: GuardrailService,
    private readonly contexts: ChatEngineContextService,
    private readonly meter: ChatEngineMeterService,
    private readonly execution: ChatEngineExecution,
    private readonly outputApproval: ChatEngineOutputApproval,
    private readonly persistence: ChatEnginePersistence,
  ) {}

  /** Runs the request and yields the events; throws a ZodError for a request that is not valid, and the signal's reason once it is aborted. */
  async *run(rawRequest: unknown, options: ChatEngineRunOptions = {}): AsyncGenerator<ChatEngineEvent> {
    const request = ChatEngineRequestSchema.parse(rawRequest);
    options.signal?.throwIfAborted();
    const authorization = await this.authorize(request);
    if (!authorization.allowed) {
      yield { type: "denied", reason: authorization.reason };
      return;
    }
    const verdict = await this.guardrail.checkInput(request.input, request.principal.runnerUserId, request.conversation.agentId);
    const approval = approveInput(request.input, verdict, CHAT_ENGINE_DEFAULT_DECLINE);
    if (approval.rejected) {
      yield* this.decline(request, approval.message, options.signal);
      return;
    }
    const context = await this.contexts.buildContext({
      agentId: request.conversation.agentId,
      runnerUserId: request.principal.runnerUserId,
      scope: authorization.scope,
      knowledgeBaseIds: authorization.agent.knowledgeBases.map((base) => base.knowledgeBaseId),
      query: approval.input,
      offeredTools: request.options.offeredTools,
    });
    yield { type: "context", context };
    yield* this.executeApproved(request, approval.input, context, authorization.agent, options.signal);
  }

  /** Runs the request to the end and returns the folded result of the same events `run` yields. */
  async collect(rawRequest: unknown, options: ChatEngineRunOptions = {}): Promise<ChatEngineResult> {
    let result = EMPTY_CHAT_ENGINE_RESULT;
    for await (const event of this.run(rawRequest, options)) result = applyChatEngineEvent(result, event);
    return result;
  }

  /** The run policy's answer for this runner and agent; an agent that does not exist is not runnable. */
  private async authorize(request: ChatEngineRequest): Promise<ChatEngineAuthorization> {
    const agent = await this.agents.findAgentForRun(request.conversation.agentId);
    if (!agent) return { allowed: false, reason: "not_runnable" };
    const decision = await this.policy.decideRun(agent, request.principal.runnerUserId);
    return decision.allowed ? { allowed: true, agent, scope: decision.scope } : decision;
  }

  /** A rejected input: the decline is the answer, stored without the raw input, with no context, execution or memory. */
  private async *decline(request: ChatEngineRequest, message: string, signal?: AbortSignal): AsyncGenerator<ChatEngineEvent> {
    signal?.throwIfAborted();
    await this.persistence.saveExchange(toExchangeRecord(request, null, message, null));
    yield { type: "declined", message };
    yield { type: "done" };
  }

  /** Runs the injected execution, metered, on the approved input; only approved tool results and the approved answer come out, and nothing is persisted once the signal is aborted. */
  private async *executeApproved(request: ChatEngineRequest, approvedInput: string, context: ChatEngineContext, agent: ChatEngineAgent, signal?: AbortSignal): AsyncGenerator<ChatEngineEvent> {
    const { principal, conversation } = request;
    const offered = new Set(context.offeredTools.map((tool) => tool.name));
    let rawOutput = "";
    const chunks = this.meter.meterExecution(toMeteredExecutionTarget(request, agent), (callModel) =>
      this.execution.execute({ principal, conversation, approvedInput, context, callModel }),
      signal,
    );
    for await (const chunk of chunks) {
      if (chunk.type === "text") rawOutput += chunk.text;
      else if (chunk.type === "budget_stopped") rawOutput = chunk.message;
      else yield* this.approveToolResult(request, offered, chunk.toolName, chunk.content);
    }
    const output = await this.outputApproval.approveOutput(rawOutput, principal.runnerUserId, conversation.agentId);
    signal?.throwIfAborted();
    const record = toExchangeRecord(request, approvedInput, output.content, context);
    await this.persistence.saveExchange(record);
    if (output.status !== "blocked") await this.persistence.handToMemory(record);
    yield { type: "content", status: output.status, content: output.content };
    yield { type: "done" };
  }

  /** A tool result is used only when its tool is offered, it meets the contract and the approval does not block it. */
  private async *approveToolResult(request: ChatEngineRequest, offered: ReadonlySet<string>, toolName: string, content: unknown): AsyncGenerator<ChatEngineEvent> {
    const parsed = ChatEngineToolResultSchema.safeParse({ toolName, content });
    if (!parsed.success || !offered.has(parsed.data.toolName)) return;
    const approval = await this.outputApproval.approveToolResult(parsed.data.content, request.principal.runnerUserId, request.conversation.agentId);
    if (approval.status !== "blocked") yield { type: "tool_result", toolName: parsed.data.toolName, content: approval.content };
  }
}
