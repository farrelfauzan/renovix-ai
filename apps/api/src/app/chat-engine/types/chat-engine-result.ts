import type { ChatEngineContext } from "./chat-engine-context";

/** The collected run: what a fold over the event stream gives. */
export type ChatEngineResult = {
  readonly status: "denied" | "declined" | "completed" | "blocked";
  readonly content: string | null;
  readonly context: ChatEngineContext | null;
  readonly toolResults: readonly { readonly toolName: string; readonly content: string }[];
};
