import type { ChatEngineContext } from "./chat-engine-context";
import type { ChatEngineRefusal } from "./chat-engine-refusal";
import type { ChatHopEvent } from "./chat-hop-event";
import type { OutputApproval } from "./output-approval";

/**
 * RNX-281: the one events contract. A streamed run yields these in order; a collected run is a fold over the same
 * stream (`collect`, with applyChatEngineEvent). The raw model output is never an event: only approved content is.
 * RNX-328: a hop's start and end (ChatHopEvent) come as the hop runs, before the run's content; they are not part of
 * the collected result (`collect` hands them to the run options' `onHopEvent`).
 */
export type ChatEngineEvent =
  | { readonly type: "denied"; readonly reason: ChatEngineRefusal }
  | { readonly type: "declined"; readonly message: string }
  | { readonly type: "context"; readonly context: ChatEngineContext }
  | { readonly type: "tool_result"; readonly toolName: string; readonly content: string }
  | ChatHopEvent
  | { readonly type: "content"; readonly status: OutputApproval["status"]; readonly content: string }
  | { readonly type: "done" };
