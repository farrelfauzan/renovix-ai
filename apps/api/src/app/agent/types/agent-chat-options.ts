/**
 * RNX-25: how a caller runs an agent message besides its text: the document format asked for, and the abort signal (the
 * SSE route's, D336; the GoWA webhook passes none). RNX-326: the route's socket timeout in milliseconds, when it sets
 * one: a run with agent calls stops a margin before it (no caller sets it yet).
 */
export type AgentChatOptions = {
  readonly documentFormat?: string;
  readonly signal?: AbortSignal;
  readonly socketTimeoutMs?: number;
};
