import type { ReconciliationEntry } from "./reconciliation-entry";

/**
 * One provider day of `GET /admin/reconciliation`. `flagged` is null when there is no portal drop (no entry for the
 * previous day) or the drift threshold has no value.
 */
export type ReconciliationRow = ReconciliationEntry & {
  readonly previousBalanceUsd: string | null;
  readonly portalDropUsd: string | null;
  readonly estimateLowUsd: string;
  readonly estimateHighUsd: string;
  readonly costUnknownCalls: number;
  readonly flagged: boolean | null;
};
