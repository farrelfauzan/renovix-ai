/** RNX-25: how a caller runs an agent message besides its text: the document format asked for, and the abort signal (the SSE route's, D336; the GoWA webhook passes none). */
export type AgentChatOptions = {
  readonly documentFormat?: string;
  readonly signal?: AbortSignal;
};
