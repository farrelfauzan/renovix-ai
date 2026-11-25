const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

/** An ISO timestamp of the API as the users screen shows it, in the viewer's own time zone, e.g. "20 Nov 2026, 15:00". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", DATE_TIME_FORMAT);
}
