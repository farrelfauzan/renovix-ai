/**
 * RNX-25: how a caller runs an agent message besides its text: the document format asked for, and the abort signal (the SSE route's, D336; the GoWA webhook passes none).
 * RNX-335: `isExternalAudience` marks a run whose reader is not the runner (the GoWA webhook: the runner is the agent's
 * owner, the reader a WhatsApp contact), so the runner's saved language is not asked for.
 */
export type AgentChatOptions = {
  readonly documentFormat?: string;
  readonly signal?: AbortSignal;
  readonly isExternalAudience?: boolean;
};
