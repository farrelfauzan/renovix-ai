import type { ReportRange } from "./report-range";

const JAKARTA = "Asia/Jakarta";
const DAY_MS = 86_400_000;

/** The `count` days ending today (Asia/Jakarta, the API's report days), both included. */
export function lastDaysRange(count: number, now: Date = new Date()): ReportRange {
  const day = (date: Date): string => date.toLocaleDateString("en-CA", { timeZone: JAKARTA });
  return { from: day(new Date(now.getTime() - (count - 1) * DAY_MS)), to: day(now) };
}
