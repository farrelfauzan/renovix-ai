import type { ReportRange } from "./report-range";

/** The longest period one read covers (the API refuses more). */
export const MAX_REPORT_DAYS = 92;
const DAY_MS = 86_400_000;

/** Why the API would refuse the range, in words; null when it is fine. */
export function describeRangeProblem({ from, to }: ReportRange): string | null {
  if (!from || !to) return "Pick both days.";
  if (to < from) return "The last day must not be before the first day.";
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  return days > MAX_REPORT_DAYS ? `A range covers at most ${MAX_REPORT_DAYS} days.` : null;
}
