import type { ChatEngineContext } from "./chat-engine-context";
import type { ChatEngineRequest } from "./chat-engine-request";

/** What an execution gets: the runner, the conversation, the approved input only (never the raw one) and the built context. */
export type ChatExecutionInput = {
  readonly principal: ChatEngineRequest["principal"];
  readonly conversation: ChatEngineRequest["conversation"];
  readonly approvedInput: string;
  readonly context: ChatEngineContext;
};
