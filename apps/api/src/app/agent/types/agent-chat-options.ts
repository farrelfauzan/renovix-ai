import type { ChatHopEvent } from "../../chat-engine/types/chat-hop-event";

/**
 * RNX-25: how a caller runs an agent message besides its text: the document format asked for, and the abort signal (the
 * SSE route's, D336; the GoWA webhook passes none). RNX-326: the route's socket timeout in milliseconds, when it sets
 * one: a run with agent calls stops a margin before it (no caller sets it yet).
 * RNX-335: `isExternalAudience` marks a run whose reader is not the runner (the GoWA webhook: the runner is the agent's
 * owner, the reader a WhatsApp contact), so the runner's saved language is not asked for.
 * RNX-328: `onHopEvent` gets the start and end of each hop of the run as they happen (the SSE route writes them).
 */
export type AgentChatOptions = {
  readonly documentFormat?: string;
  readonly signal?: AbortSignal;
  readonly socketTimeoutMs?: number;
  readonly isExternalAudience?: boolean;
  readonly onHopEvent?: (event: ChatHopEvent) => void;
};
