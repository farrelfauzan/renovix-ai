/** One calendar day in milliseconds. */
const DAY_MS = 86_400_000;

/** The calendar day before `day` (YYYY-MM-DD). */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}
