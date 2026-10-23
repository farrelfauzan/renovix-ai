/** Asia/Jakarta is UTC+7 all year (no daylight saving time). */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/** RNX-232: 00:00 Asia/Jakarta on the first day of the Jakarta calendar month that contains `now`, as an instant. */
export function startOfJakartaMonth(now: Date): Date {
  const jakarta = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  return new Date(Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), 1) - JAKARTA_OFFSET_MS);
}
