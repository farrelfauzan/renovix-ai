import { CHAT_ENGINE_DEFAULT_MAX_TOKENS } from "../config/chat-engine.config";
import type { ChatModelRequest } from "../types/chat-model-request";
import type { ChatToolLoopRun } from "../types/chat-tool-loop-run";

/**
 * RNX-283: the loop's next model call: its messages so far, the agent's temperature and max_tokens, and the offered
 * tools only (none: no tools field). The adapters send the messages as given, tool calls and tool results included.
 */
export function toLoopModelRequest(loop: ChatToolLoopRun): ChatModelRequest {
  const { agent } = loop.input;
  return {
    messages: [...loop.messages] as ChatModelRequest["messages"],
    temperature: agent.temperature,
    max_tokens: agent.maxTokens ?? CHAT_ENGINE_DEFAULT_MAX_TOKENS,
    ...(loop.tools.length > 0 && { tools: [...loop.tools], tool_choice: "auto" }),
  };
}
