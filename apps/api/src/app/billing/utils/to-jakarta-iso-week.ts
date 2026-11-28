/** Asia/Jakarta is UTC+7 all year (no daylight saving time). */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
/** ISO 8601 numbers Monday 1 to Sunday 7, and a week belongs to the year of its Thursday. */
const ISO_SUNDAY = 7;
const ISO_THURSDAY = 4;

/**
 * RNX-321: the ISO 8601 week that contains `now` on the Asia/Jakarta calendar, as "YYYY-Www" (e.g. "2026-W48"). The year
 * is the ISO week-numbering year, so the days around 1 January can belong to the previous or the next year's week.
 */
export function toJakartaIsoWeek(now: Date): string {
  const jakarta = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  const day = Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate());
  const isoWeekday = jakarta.getUTCDay() || ISO_SUNDAY;
  const thursday = new Date(day + (ISO_THURSDAY - isoWeekday) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / DAYS_PER_WEEK) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
