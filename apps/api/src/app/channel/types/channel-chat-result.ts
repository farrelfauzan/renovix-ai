import type { StoredDocumentResult } from "../../document/service/document.service";

/**
 * The reply of one channel chat message: its content, the tokens of its model calls and the saved assistant message.
 * RNX-222: and the document this run's own `create_document` call generated, if any.
 */
export type ChannelChatResult = {
  readonly content: string;
  readonly totalTokens: number;
  readonly assistantMessageId?: string;
  readonly document?: StoredDocumentResult | null;
};
