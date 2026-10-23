/** One calendar day in milliseconds. */
const DAY_MS = 86_400_000;

/** How many calendar days `from` to `to` (YYYY-MM-DD, both included) span, in O(1); 0 or less when `to` is before `from`. */
export function countDays(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}
