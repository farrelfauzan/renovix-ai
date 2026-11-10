import type { ChatEngineContext } from "./chat-engine-context";
import type { ChatEngineRequest } from "./chat-engine-request";
import type { ChatModelCall } from "./chat-model-call";

/**
 * What an execution gets: the runner, the conversation, the approved input only (never the raw one), the built context
 * and (RNX-282) `callModel`, its only way to the model, metered on the run's reservation.
 */
export type ChatExecutionInput = {
  readonly principal: ChatEngineRequest["principal"];
  readonly conversation: ChatEngineRequest["conversation"];
  readonly approvedInput: string;
  readonly context: ChatEngineContext;
  readonly callModel: ChatModelCall;
};
