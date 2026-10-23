/**
 * The total timeout of the status check a webhook starts (RNX-229, D280), in milliseconds: short enough that the
 * webhook answers within AutoGoPay's 10 s. A timed-out check counts as unknown; the reconciliation job completes it.
 */
export const WEBHOOK_STATUS_TIMEOUT_MS = 5_000;
