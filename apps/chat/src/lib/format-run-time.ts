/** A scheduled run's time as "DD/MM/YYYY HH:mm" in the given IANA timezone. */
export function formatRunTime(isoTime: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return format.format(new Date(isoTime)).replace(",", "");
}
