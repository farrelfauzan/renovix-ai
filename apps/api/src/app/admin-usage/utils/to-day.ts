/** A date column's value (UTC midnight) as YYYY-MM-DD. */
export function toDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
