import type { ChatHopEvent } from "./chat-hop-event";

/**
 * What an execution yields: a piece of the model's raw text, or a tool result (checked against the contract by the
 * engine). RNX-328: or a hop's start or end, while the call_agent call that made it runs.
 */
export type ChatExecutionChunk =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_result"; readonly toolName: string; readonly content: unknown }
  | ChatHopEvent;
