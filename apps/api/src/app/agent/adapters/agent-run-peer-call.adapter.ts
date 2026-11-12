import { Logger } from "@nestjs/common";
import { MODEL_UNAVAILABLE_MESSAGE, ModelUnavailableException } from "../../config/errors/model-unavailable.exception";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ChatEnginePeerCall } from "../../chat-engine/ports/chat-engine-peer-call.port";
import type { ChatPeerCallRequest } from "../../chat-engine/types/chat-peer-call-request";
import type { ChatResponse } from "../../providers/provider.interface";
import type { ModelConnection } from "../../providers/types/model-connection";
import { RunBudgetStoppedError } from "../errors/run-budget-stopped.error";
import type { CallableAgent } from "../types/callable-agent";
import type { ChatEngineAgent } from "../../chat-engine/types/chat-engine-agent";

/** The max_tokens of the called agent's call when it sets none (as before). */
const SUB_AGENT_DEFAULT_MAX_TOKENS = 4096;

/**
 * One hop (RX-22b), behind call_agent (RNX-118), on the chat engine's agent-call port (RNX-25, D323), moved unchanged
 * from AgentRunService.executeSubAgent until RNX-121 replaces it: the called agent's one model call (no tools,
 * knowledge, memory or guardrail) is metered on the run (the request's `callModel`) against its own model's connection,
 * with the calling model call as its parent. Only an agent of `callableAgents` (a linked callee in the caller's
 * workspace, none for a runner outside it) is called; any other name is refused and nothing runs. One per agent message.
 */
export class AgentRunPeerCall extends ChatEnginePeerCall {
  private readonly logger = new Logger(AgentRunPeerCall.name);

  constructor(
    private readonly registry: ModelRegistryService,
    private readonly caller: Pick<ChatEngineAgent, "id" | "name">,
    private readonly callableAgents: readonly CallableAgent[],
  ) {
    super();
  }

  /** The called agent's answer, or the "Error: …" text of a refused or failed hop; the budget stop ends the run. */
  async callPeer(request: ChatPeerCallRequest): Promise<string> {
    const args = request.args as { agent?: unknown; task?: unknown; context?: unknown } | null;
    this.logger.log(`[executeSubAgent] START | caller=${this.caller.name} args=${JSON.stringify(args)}`);
    const rawIdentifier = typeof args?.agent === "string" ? args.agent.trim() : "";
    const task = typeof args?.task === "string" ? args.task.trim() : "";
    const taskContext = typeof args?.context === "string" ? args.context.trim() : "";
    if (!rawIdentifier) {
      this.logger.warn(`[executeSubAgent] MISSING identifier in args`);
      return "Error: Missing agent. Provide the name or id of a callable agent.";
    }
    if (!task) return "Error: Missing task for the called agent.";
    const subAgent = this.findCallee(rawIdentifier);
    if (!subAgent) {
      this.logger.warn(`[executeSubAgent] Agent NOT CALLABLE | callerId=${this.caller.id} identifier="${rawIdentifier}"`);
      return "Error: Agent not found or not linked.";
    }
    this.logger.log(`[executeSubAgent] Found sub-agent: id=${subAgent.id} name=${subAgent.name} | task="${task.slice(0, 100)}"`);
    const content = `Task from agent "${this.caller.name}": ${task}${taskContext ? `\n\nContext: ${taskContext}` : ""}`;
    return this.callSubAgent(request, subAgent, content);
  }

  /** The callable agent with this id, or this name in any casing (RNX-124 D165). */
  private findCallee(identifier: string): CallableAgent | undefined {
    return this.callableAgents.find((callee) => callee.id === identifier || callee.name.toLowerCase() === identifier.toLowerCase());
  }

  /** RX-178 review N3: a sub-agent whose model cannot be resolved is a failed hop (the fixed text), not a failed run. */
  private async callSubAgent(request: ChatPeerCallRequest, subAgent: CallableAgent, task: string): Promise<string> {
    let connection: ModelConnection;
    try {
      connection = await this.resolveConnection(subAgent.model);
    } catch (err) {
      if (!(err instanceof ModelUnavailableException)) throw err;
      this.logger.warn(`[executeSubAgent] sub-agent ${subAgent.id}: model not available`);
      return `Error: ${MODEL_UNAVAILABLE_MESSAGE}`;
    }
    const messages = [
      { role: "system" as const, content: subAgent.systemPrompt },
      { role: "user" as const, content: task },
    ];
    this.logger.log(
      `[executeSubAgent] Calling LLM: provider=${connection.providerName} model=${connection.slug} (no tools) | payload=${(JSON.stringify(messages).length / 1024).toFixed(1)}KB`,
    );
    return this.answerOf(request, subAgent, connection, messages);
  }

  /** The called agent's one metered call (no tools): its text, the fixed text for an empty answer, or the failed-call text. */
  private async answerOf(request: ChatPeerCallRequest, subAgent: CallableAgent, connection: ModelConnection, messages: { role: "system" | "user"; content: string }[]): Promise<string> {
    const subStartTime = Date.now();
    let response: ChatResponse;
    try {
      const hop = { agentId: subAgent.id, connection, parentCallId: request.parentCallId };
      ({ response } = await request.callModel({ messages, temperature: subAgent.temperature, max_tokens: subAgent.maxTokens ?? SUB_AGENT_DEFAULT_MAX_TOKENS }, hop));
    } catch (err) {
      if (err instanceof RunBudgetStoppedError) throw err;
      const failure = err as { message?: string; status?: number; stack?: string };
      this.logger.error(`[executeSubAgent] LLM call FAILED in ${Date.now() - subStartTime}ms: ${failure.message} | status=${failure.status}`, failure.stack);
      return `Error: Sub-agent LLM call failed (${failure.status || "unknown"}): ${failure.message}`;
    }
    const subResult = response.choices?.[0]?.message?.content || "Sub-agent completed without output.";
    this.logger.log(
      `[executeSubAgent] DONE in ${Date.now() - subStartTime}ms | prompt=${response.usage?.prompt_tokens ?? "?"} completion=${response.usage?.completion_tokens ?? "?"} total=${response.usage?.total_tokens ?? "?"} | resultLen=${subResult.length}: ${subResult.slice(0, 200)}`,
    );
    return subResult;
  }

  /** The called agent's model's connection, as the run resolved it before; ModelUnavailableException when it cannot be resolved. */
  private async resolveConnection(model: string): Promise<ModelConnection> {
    const modelConfig = await this.registry.resolveModel(model);
    if (!modelConfig) throw new ModelUnavailableException();
    return this.registry.resolveConnection(modelConfig.slug);
  }
}
