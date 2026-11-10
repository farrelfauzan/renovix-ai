import type { ChatEngineContext } from "./chat-engine-context";
import type { ChatEngineRefusal } from "./chat-engine-refusal";
import type { OutputApproval } from "./output-approval";

/**
 * RNX-281: the one events contract. A streamed run yields these in order; a collected run is a fold over the same
 * stream (`collect`, with applyChatEngineEvent). The raw model output is never an event: only approved content is.
 */
export type ChatEngineEvent =
  | { readonly type: "denied"; readonly reason: ChatEngineRefusal }
  | { readonly type: "declined"; readonly message: string }
  | { readonly type: "context"; readonly context: ChatEngineContext }
  | { readonly type: "tool_result"; readonly toolName: string; readonly content: string }
  | { readonly type: "content"; readonly status: OutputApproval["status"]; readonly content: string }
  | { readonly type: "done" };
