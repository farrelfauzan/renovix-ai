/** The browser's IANA time zone, or null when it gives nothing usable (none, or one this runtime does not know). */
export function detectTimeZone(): string | null {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}
