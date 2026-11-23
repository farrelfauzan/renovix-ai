import type { PaidUsageSummary } from "../../billing/types/paid-usage-summary";
import type { CompleteCreditMeterSettings } from "./complete-credit-meter-settings";
import type { CreditWarningCandidate } from "./credit-warning-candidate";

/** RNX-329: what the run-out warning check needs to check one account of a page. */
export type CreditWarningAccountCheck = {
  readonly candidate: CreditWarningCandidate;
  readonly now: Date;
  readonly settings: CompleteCreditMeterSettings;
  /** The paid wallet's usage in the projection window. */
  readonly usage: PaidUsageSummary;
  /** The owner's due reminders (see `dueReminderWindow`). */
  readonly dueReminderCount: number;
};
