const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const DATETIME_LOCAL_LENGTH = 16;

const toDatetimeLocal = (date: Date): string => new Date(date.getTime() - date.getTimezoneOffset() * MILLISECONDS_PER_MINUTE).toISOString().slice(0, DATETIME_LOCAL_LENGTH);

/** The From and To of a "last `days` days" preset (RX-371): `datetime-local` values in the browser's time zone, To being `now`. */
export function buildAuditLogPresetRange(days: number, now: Date = new Date()): { readonly from: string; readonly to: string } {
  return { from: toDatetimeLocal(new Date(now.getTime() - days * MILLISECONDS_PER_DAY)), to: toDatetimeLocal(now) };
}
