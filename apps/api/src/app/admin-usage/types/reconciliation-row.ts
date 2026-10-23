import type { ReconciliationEntryView } from "./reconciliation-entry-view";

/**
 * One provider record's day in the reconciliation (RNX-228), for a day with an entered balance.
 * - portal drop = the previous day's balance + this day's top-up - this day's balance (USD); null without an entry for
 *   the previous day;
 * - our estimate = the sums of the low and high cost of that provider's calls that day (high = low when the provider's
 *   high case is off, RNX-162); calls of unknown cost are counted, not added;
 * - flagged when the drop is above the high estimate by more than the drift threshold, as a percentage of the high
 *   estimate: drop > high x (1 + threshold / 100). Null when there is no drop or the threshold has no value.
 */
export type ReconciliationRow = ReconciliationEntryView & {
  readonly previousBalanceUsd: string | null;
  readonly portalDropUsd: string | null;
  readonly estimateLowUsd: string;
  readonly estimateHighUsd: string;
  readonly costUnknownCalls: number;
  readonly flagged: boolean | null;
};
