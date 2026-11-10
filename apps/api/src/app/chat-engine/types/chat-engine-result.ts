import type { ChatEngineContext } from "./chat-engine-context";
import type { ChatEngineRefusal } from "./chat-engine-refusal";

/** The collected run: what a fold over the event stream gives. `reason` is the run policy's refusal of a denied run, else null. */
export type ChatEngineResult = {
  readonly status: "denied" | "declined" | "completed" | "blocked";
  readonly reason: ChatEngineRefusal | null;
  readonly content: string | null;
  readonly context: ChatEngineContext | null;
  readonly toolResults: readonly { readonly toolName: string; readonly content: string }[];
};
