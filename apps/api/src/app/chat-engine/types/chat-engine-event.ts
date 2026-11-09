import type { RunDecision } from "../../agent/types/run-decision";
import type { ChatEngineContext } from "./chat-engine-context";
import type { OutputApproval } from "./output-approval";

/** The refusal reasons of the run policy. */
type Refusal = Extract<RunDecision, { allowed: false }>["reason"];

/**
 * RNX-281: the one events contract. A streamed run yields these in order; a collected run is a fold over the same
 * stream (foldChatEngineEvents). The raw model output is never an event: only approved content is.
 */
export type ChatEngineEvent =
  | { readonly type: "denied"; readonly reason: Refusal }
  | { readonly type: "declined"; readonly message: string }
  | { readonly type: "context"; readonly context: ChatEngineContext }
  | { readonly type: "tool_result"; readonly toolName: string; readonly content: string }
  | { readonly type: "content"; readonly status: OutputApproval["status"]; readonly content: string }
  | { readonly type: "done" };
