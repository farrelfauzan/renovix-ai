import type { CreditMeterLevel } from "./credit-meter-level";
import type { CreditMeterReminder } from "./credit-meter-reminder";
import type { RunOutProjection } from "./run-out-projection";

/** RNX-30-A: GET /chat/portal/credit-meter, the signed-in user's own credit meter. Credit amounts are decimal strings. */
export type CreditMeter = {
  /** The paid wallet's available credits, balance - held ("0" without a paid wallet). */
  readonly paidAvailable: string;
  /** The weekly_free wallet's available credits, balance - held ("0" without one); it gets no projection. */
  readonly weeklyFreeAvailable: string;
  readonly projection: RunOutProjection;
  readonly level: CreditMeterLevel;
  /** Paid available below runOutFloorCredits, or below perRunCreditCap times the due reminders. */
  readonly belowFloor: boolean;
  /** In the red state, the active reminders due before the run-out instant, earliest first; otherwise empty. */
  readonly dueReminders: readonly CreditMeterReminder[];
};
