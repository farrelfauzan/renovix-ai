import { ChatEngineExecution } from "../../chat-engine/ports/chat-engine-execution.port";
import { CHAT_ENGINE_DEFAULT_MAX_TOKENS } from "../../chat-engine/config/chat-engine.config";
import type { ChargedResponse } from "../../chat-engine/types/charged-response";
import type { ChatExecutionChunk } from "../../chat-engine/types/chat-execution-chunk";
import type { ChatExecutionInput } from "../../chat-engine/types/chat-execution-input";
import type { ChatHopTarget } from "../../chat-engine/types/chat-hop-target";
import type { ChatModelCall } from "../../chat-engine/types/chat-model-call";
import type { ChatModelRequest } from "../../chat-engine/types/chat-model-request";
import { RunBudgetStoppedError } from "../../agent/errors/run-budget-stopped.error";
import { RunLimitStoppedError } from "../../agent/errors/run-limit-stopped.error";
import type { PeerRunState } from "../../agent/types/peer-run-state";
import { CHANNEL_CHAT_DOCUMENT_MAX_TOKENS } from "../config/channel-chat-document-max-tokens";
import { CHANNEL_CHAT_MAX_STEPS_MESSAGE } from "../config/channel-chat-max-steps-message";
import type { ChannelChatPromptInput } from "../types/channel-chat-prompt-input";
import type { ChannelChatTurn } from "../types/channel-chat-turn";
import { buildChannelChatSystemPrompt } from "../utils/build-channel-chat-system-prompt";

/**
 * RNX-24a: the channel chat's (CH) execution port, one per message, around the engine's tool loop (its `channel-chat`
 * profile keeps the CH loop: 30 rounds, `length` continued, tool results cut at 4,000 characters, a response without a
 * choice ends with the max-steps text). It keeps the CH parts the loop does not have: the CH system prompt (with the
 * room's workspace memory folded in), the document mode's max_tokens (at least 8,192), and the run's totals on the
 * turn: the root agent's tokens (a called agent's are not counted, as before), and whether the run stopped at its
 * budget or ended with the max-steps text. The run's agent calls are RNX-121's step, so its per-call
 * rules apply (depth, the agent-call count, the call timeout, refused rows). RNX-326's run limits are NOT enforced
 * here: the first agent call sets the model-call cap and the run timer, but this execution neither counts model calls
 * nor reads the stop signal (D381: RNX-351 adds both). The timer is cleared when the run ends, however it ends.
 */
export class ChannelChatExecution extends ChatEngineExecution {
  constructor(
    private readonly loop: ChatEngineExecution,
    private readonly turn: ChannelChatTurn,
    private readonly prompt: Omit<ChannelChatPromptInput, "memory">,
    private readonly peerRun: PeerRunState,
  ) {
    super();
  }

  /** Runs the tool loop for this input with the CH prompt and counted model calls, and yields its chunks. */
  async *execute(input: ChatExecutionInput): AsyncGenerator<ChatExecutionChunk> {
    try {
      for await (const chunk of this.loop.execute(this.toLoopInput(input))) {
        if (chunk.type === "text") this.turn.isMaxSteps = chunk.text === CHANNEL_CHAT_MAX_STEPS_MESSAGE;
        yield chunk;
      }
    } catch (err) {
      if (err instanceof RunBudgetStoppedError || err instanceof RunLimitStoppedError) this.turn.isBudgetStopped = true;
      throw err;
    } finally {
      clearTimeout(this.peerRun.stopTimer);
    }
  }

  /** The loop's input: the CH system prompt as the agent's prompt (the memory inside it), the CH max_tokens and the counted model call. */
  private toLoopInput(input: ChatExecutionInput): ChatExecutionInput {
    const { agent, context, callModel } = input;
    const systemPrompt = buildChannelChatSystemPrompt({ ...this.prompt, memory: context.memory });
    const maxTokens = this.prompt.documentFormat ? Math.max(agent.maxTokens ?? CHAT_ENGINE_DEFAULT_MAX_TOKENS, CHANNEL_CHAT_DOCUMENT_MAX_TOKENS) : agent.maxTokens;
    return {
      ...input,
      agent: { ...agent, systemPrompt, maxTokens },
      context: { ...context, knowledge: "", memory: "" },
      callModel: (request, hop) => this.callAndCount(callModel, request, hop),
    };
  }

  /** One metered call; a root call's tokens add to the run's tokens (a hop's do not, as before). */
  private async callAndCount(callModel: ChatModelCall, request: ChatModelRequest, hop?: ChatHopTarget): Promise<ChargedResponse> {
    const metered = await callModel(request, hop);
    if (!hop) this.turn.totalTokens += metered.response.usage?.total_tokens || 0;
    return metered;
  }
}
