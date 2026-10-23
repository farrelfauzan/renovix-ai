/** One calendar day in milliseconds. */
const DAY_MS = 86_400_000;

/** Every calendar day from `from` to `to` (YYYY-MM-DD, both included), in order; empty when `to` is before `from`. */
export function listDays(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const count = Math.floor((Date.parse(`${to}T00:00:00Z`) - start) / DAY_MS) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_unused, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10));
}
