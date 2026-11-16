import { RUN_OUT_PROJECTION } from "../config/run-out-projection";
import type { RunOutProjection } from "../types/run-out-projection";
import type { RunOutProjectionInput } from "../types/run-out-projection-input";
import { formatRunOutLabel } from "./format-run-out-label";
import { MS_PER_DAY } from "../config/ms-per-day";

/**
 * RNX-30-A (D45): the paid wallet's run-out. Rate = paid credits spent in the window / window days; run-out = now +
 * paid available / rate. "Not enough use" with fewer than the minimum distinct usage days, a spend below
 * projectionMinSpendCredits, or projectionMinSpendCredits or projectionMaxDays not set; "more than a year" when the
 * run-out is more than projectionMaxDays days away.
 */
export function projectRunOut(input: RunOutProjectionInput): RunOutProjection {
  const { minSpendCredits, maxDays, spentInWindow } = input;
  if (minSpendCredits === null || maxDays === null) return { status: "not_enough_use" };
  if (input.usageDays < RUN_OUT_PROJECTION.minUsageDays) return { status: "not_enough_use" };
  if (spentInWindow.lte(0) || spentInWindow.lt(minSpendCredits)) return { status: "not_enough_use" };
  const daysLeft = input.paidAvailable.mul(RUN_OUT_PROJECTION.windowDays).div(spentInWindow);
  if (daysLeft.gt(maxDays)) return { status: "more_than_a_year" };
  const runOutAt = new Date(input.now.getTime() + daysLeft.mul(MS_PER_DAY).floor().toNumber());
  return { status: "date", runOutAt, runOutLabel: formatRunOutLabel(runOutAt, input.timeZone), timeZone: input.timeZone };
}
