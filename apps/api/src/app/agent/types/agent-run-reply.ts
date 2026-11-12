import type { StoredDocumentResult } from "../../document/service/document.service";

/** RNX-25: the answer to one agent message: its session row and session id, the approved answer, the run's tokens and cost, and the document its own `create_document` call made (RNX-222; absent on a decline). */
export type AgentRunReply = {
  readonly runId: string;
  readonly sessionId: string;
  readonly message: { readonly role: "assistant"; readonly content: string };
  readonly usage: { readonly totalTokens: number; readonly cost: string };
  readonly document?: StoredDocumentResult | null;
};
