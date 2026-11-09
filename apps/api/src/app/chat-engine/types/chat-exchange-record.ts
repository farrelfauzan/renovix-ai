import type { ChatEngineContext } from "./chat-engine-context";
import type { ChatEngineRequest } from "./chat-engine-request";

/** What the engine persists for one exchange: only approved content. `approvedInput` is null when the input was rejected (the decline is the output). */
export type ChatExchangeRecord = {
  readonly principal: ChatEngineRequest["principal"];
  readonly source: ChatEngineRequest["source"];
  readonly conversation: ChatEngineRequest["conversation"];
  readonly approvedInput: string | null;
  readonly approvedOutput: string;
  readonly context: ChatEngineContext | null;
};
