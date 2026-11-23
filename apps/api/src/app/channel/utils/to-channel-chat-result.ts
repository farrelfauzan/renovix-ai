import type { ChatEngineResult } from "../../chat-engine/types/chat-engine-result";
import type { McpRunSession } from "../../agent/types/mcp-run-session";
import { toRunRefusalException } from "../../agent/utils/to-run-refusal-exception";
import type { ChannelChatResult } from "../types/channel-chat-result";
import type { ChannelChatTurn } from "../types/channel-chat-turn";

/**
 * RNX-24a: the channel chat's reply from its collected run on the chat engine, as the legacy CH loop answered: a refusal
 * is thrown (as the run policy's asserts), a decline has 0 tokens, an answer carries the root agent's tokens (0 after a
 * budget stop), the stored message's id (none for an empty answer) and the document its `create_document` call made.
 */
export function toChannelChatResult(result: ChatEngineResult, turn: ChannelChatTurn, mcpSession: McpRunSession): ChannelChatResult {
  if (result.status === "denied") throw toRunRefusalException(result.reason ?? "not_runnable");
  const reply = { content: result.content ?? "", ...(turn.assistantMessageId && { assistantMessageId: turn.assistantMessageId }) };
  if (result.status === "declined") return { ...reply, totalTokens: 0 };
  return { ...reply, totalTokens: turn.isBudgetStopped ? 0 : turn.totalTokens, document: mcpSession.document };
}
