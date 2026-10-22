import type { TimeRange } from "../types/time-range";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instants of one Asia/Jakarta day "YYYY-MM-DD": from its midnight (included) to the next (excluded) (RNX-35). */
export function jakartaDayRange(day: string): TimeRange {
  const start = new Date(`${day}T00:00:00+07:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}
