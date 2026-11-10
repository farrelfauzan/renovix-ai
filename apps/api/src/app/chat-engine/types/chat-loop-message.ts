import type { ChatMessage } from "../../providers/provider.interface";
import type { ChatModelReply } from "./chat-model-reply";

/** RNX-283: one message the tool loop sends the model: a plain message, a reply with its tool calls, or a tool's result. */
export type ChatLoopMessage =
  | ChatMessage
  | ChatModelReply
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };
