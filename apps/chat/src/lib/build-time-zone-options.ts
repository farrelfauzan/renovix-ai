/** The Indonesian zones offered first, with the label Indonesians use for each. */
const INDONESIA_TIME_ZONES = [
  { value: "Asia/Jakarta", label: "Asia/Jakarta (WIB)" },
  { value: "Asia/Makassar", label: "Asia/Makassar (WITA)" },
  { value: "Asia/Jayapura", label: "Asia/Jayapura (WIT)" },
] as const;

/**
 * The profile step's timezone choices (RNX-289): WIB, WITA and WIT first, then the other IANA zones. The stored
 * value is always the IANA id; the current value is kept in the list even when the browser does not list it.
 */
export function buildTimeZoneOptions({ current, supported }: { current: string; supported: readonly string[] }): { value: string; label: string }[] {
  const indonesian = INDONESIA_TIME_ZONES.map((zone) => zone.value as string);
  const rest = [...new Set([...supported, current].filter(Boolean))].filter((zone) => !indonesian.includes(zone));
  return [...INDONESIA_TIME_ZONES, ...rest.map((zone) => ({ value: zone, label: zone }))];
}
