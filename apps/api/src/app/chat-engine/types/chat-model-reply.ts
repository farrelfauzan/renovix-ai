import type { ChatToolCall } from "./chat-tool-call";

/** RNX-283: the assistant message of a model reply as the tool loop reads it: its text and its tool calls, if any. */
export type ChatModelReply = {
  readonly role: "assistant";
  readonly content?: string | null;
  readonly tool_calls?: readonly ChatToolCall[];
};
