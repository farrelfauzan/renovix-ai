import { ChatEngineExecution } from "../../chat-engine/ports/chat-engine-execution.port";
import type { ChargedResponse } from "../../chat-engine/types/charged-response";
import type { ChatExecutionChunk } from "../../chat-engine/types/chat-execution-chunk";
import type { ChatExecutionInput } from "../../chat-engine/types/chat-execution-input";
import type { ChatHopTarget } from "../../chat-engine/types/chat-hop-target";
import type { ChatModelCall } from "../../chat-engine/types/chat-model-call";
import type { ChatModelRequest } from "../../chat-engine/types/chat-model-request";
import { RunBudgetStoppedError } from "../errors/run-budget-stopped.error";
import { RunLimitStoppedError } from "../errors/run-limit-stopped.error";
import type { AgentRunPromptInput } from "../types/agent-run-prompt-input";
import type { AgentRunTurn } from "../types/agent-run-turn";
import type { PeerRunState } from "../types/peer-run-state";
import { buildAgentRunSystemPrompt } from "../utils/build-agent-run-system-prompt";

/**
 * RNX-25: the agent run's (AR) execution port, one per agent message, around the engine's tool loop. It keeps the AR
 * parts the loop does not have: the AR system prompt (buildAgentRunSystemPrompt, with the permitted knowledge and memory folded in, so the
 * loop sends it as the whole system message), and the run's totals on the turn: the root agent's tokens, the charge of
 * every model call (root and hop, D341 D5) and whether the run stopped at its budget. RNX-326: every model call of the
 * run (root and hop) passes here, so here the run's model calls are counted against its cap and, once its limits have
 * started (its first agent call), carry its stop signal; a run-limit stop ends the run as a budget stop does, and the
 * stop timer is cleared when the run ends, however it ends.
 */
export class AgentRunExecution extends ChatEngineExecution {
  constructor(
    private readonly loop: ChatEngineExecution,
    private readonly turn: AgentRunTurn,
    private readonly prompt: Omit<AgentRunPromptInput, "knowledge" | "memory">,
    private readonly peerRun: PeerRunState,
  ) {
    super();
  }

  /** Runs the tool loop for this input with the AR prompt and counted model calls, and yields its chunks. */
  async *execute(input: ChatExecutionInput): AsyncGenerator<ChatExecutionChunk> {
    try {
      yield* this.loop.execute(this.toLoopInput(input));
    } catch (err) {
      if (err instanceof RunBudgetStoppedError || err instanceof RunLimitStoppedError) this.turn.isBudgetStopped = true;
      throw err;
    } finally {
      clearTimeout(this.peerRun.stopTimer);
    }
  }

  /** The loop's input: the AR system prompt as the agent's prompt (knowledge and memory inside it) and the counted model call. */
  private toLoopInput(input: ChatExecutionInput): ChatExecutionInput {
    const { context, agent, callModel } = input;
    const systemPrompt = buildAgentRunSystemPrompt({ ...this.prompt, knowledge: context.knowledge, memory: context.memory });
    return {
      ...input,
      agent: { ...agent, systemPrompt },
      context: { ...context, knowledge: "", memory: "" },
      callModel: (request, hop) => this.callAndCount(callModel, request, hop),
    };
  }

  /**
   * One metered call; its charge adds to the run's cost, and a root call's tokens to the run's tokens (a hop's do not, as
   * before). RNX-326: refused (no call) once the run is stopped or at its model-call cap; with the run's stop signal once
   * its limits have started, so the run's time limit aborts it.
   */
  private async callAndCount(callModel: ChatModelCall, request: ChatModelRequest, hop?: ChatHopTarget): Promise<ChargedResponse> {
    this.assertRunNotStopped();
    this.peerRun.modelCalls++;
    const hasRunLimits = this.peerRun.maxModelCalls !== undefined;
    const metered = await callModel(hasRunLimits ? { ...request, signal: this.peerRun.stop.signal } : request, hop);
    this.turn.totalCost = this.turn.totalCost.plus(metered.charge);
    if (!hop) this.turn.totalTokens += metered.response.usage?.total_tokens || 0;
    return metered;
  }

  /** RNX-326: the run's model-call cap reached stops the run; a stopped run throws its stop (RunLimitStoppedError). */
  private assertRunNotStopped(): void {
    const { modelCalls, maxModelCalls, stop } = this.peerRun;
    if (maxModelCalls !== undefined && modelCalls >= maxModelCalls) stop.abort(new RunLimitStoppedError("model_calls"));
    stop.signal.throwIfAborted();
  }
}
