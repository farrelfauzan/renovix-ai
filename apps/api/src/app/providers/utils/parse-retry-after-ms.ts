/** A Retry-After header (seconds or an HTTP date, RFC 9110) in milliseconds; undefined when absent or unreadable. */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(date - now, 0);
}
