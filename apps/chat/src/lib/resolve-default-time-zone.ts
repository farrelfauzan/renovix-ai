/** Indonesia's default time zone (WIB) when the browser gives none (RNX-33). */
const INDONESIA_TIME_ZONE = "Asia/Jakarta";

/**
 * The profile step's default time zone: the browser's, else Asia/Jakarta when the country is Indonesia, else none
 * (the user picks one).
 */
export function resolveDefaultTimeZone({ detected, country }: { detected: string | null; country: string }): string {
  if (detected) return detected;
  return country === "ID" ? INDONESIA_TIME_ZONE : "";
}
