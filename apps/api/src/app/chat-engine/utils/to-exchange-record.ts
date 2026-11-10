import type { ChatEngineContext } from "../types/chat-engine-context";
import type { ChatEngineRequest } from "../types/chat-engine-request";
import type { ChatExchangeRecord } from "../types/chat-exchange-record";

/** The exchange the persistence port stores: the request's identity and only the approved input, output and context. */
export function toExchangeRecord(request: ChatEngineRequest, approvedInput: string | null, approvedOutput: string, context: ChatEngineContext | null): ChatExchangeRecord {
  return { principal: request.principal, source: request.source, conversation: request.conversation, approvedInput, approvedOutput, context };
}
