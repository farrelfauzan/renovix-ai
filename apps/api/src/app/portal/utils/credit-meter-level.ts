import type { CreditMeterLevel } from "../types/credit-meter-level";
import type { CreditMeterLevelInput } from "../types/credit-meter-level-input";
import { MS_PER_DAY } from "../config/ms-per-day";

/**
 * RNX-30-A (D47): red when the projected run-out is within runOutRedDays days of now, else amber within
 * runOutAmberDays days, else none. No projected date: none. A setting that is not set skips its check.
 */
export function creditMeterLevel(input: CreditMeterLevelInput): CreditMeterLevel {
  if (input.runOutAt === null) return "none";
  const daysLeft = (input.runOutAt.getTime() - input.now.getTime()) / MS_PER_DAY;
  if (input.redDays !== null && daysLeft <= input.redDays) return "red";
  if (input.amberDays !== null && daysLeft <= input.amberDays) return "amber";
  return "none";
}
