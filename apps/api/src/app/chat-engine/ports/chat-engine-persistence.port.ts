import type { ChatExchangeRecord } from "../types/chat-exchange-record";

/** RNX-281: the persistence port. It receives approved content and context only, and the approved exchange for memory when the output was not blocked. */
export abstract class ChatEnginePersistence {
  /** Stores one exchange: the approved input (null when rejected), the approved output and the context. */
  abstract saveExchange(record: ChatExchangeRecord): Promise<void>;

  /** Hands the approved exchange to memory; never called for a blocked output or a rejected input. */
  abstract handToMemory(record: ChatExchangeRecord): Promise<void>;
}
