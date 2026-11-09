import type { ChatExecutionChunk } from "../types/chat-execution-chunk";
import type { ChatExecutionInput } from "../types/chat-execution-input";

/**
 * RNX-281: the model execution, injected. The engine has no production execution (tickets B and C bring it); it only
 * hands over the approved input and context and receives the raw chunks, which it approves before anything leaves it.
 */
export abstract class ChatEngineExecution {
  /** Runs the model for this input and yields its raw text and tool results. */
  abstract execute(input: ChatExecutionInput): AsyncIterable<ChatExecutionChunk>;
}
