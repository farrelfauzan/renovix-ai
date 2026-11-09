import type { ChatEngineEvent } from "../types/chat-engine-event";
import type { ChatEngineResult } from "../types/chat-engine-result";

/** Folds one event into the collected result; a collected run is this fold over the same stream a streamed run yields. */
export function applyChatEngineEvent(result: ChatEngineResult, event: ChatEngineEvent): ChatEngineResult {
  if (event.type === "denied") return { ...result, status: "denied" };
  if (event.type === "declined") return { ...result, status: "declined", content: event.message };
  if (event.type === "context") return { ...result, context: event.context };
  if (event.type === "tool_result") return { ...result, toolResults: [...result.toolResults, { toolName: event.toolName, content: event.content }] };
  if (event.type === "content") return { ...result, status: event.status === "blocked" ? "blocked" : "completed", content: event.content };
  return result;
}
