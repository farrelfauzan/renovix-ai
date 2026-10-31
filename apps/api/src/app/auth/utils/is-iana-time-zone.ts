/**
 * True when `value` names an IANA time zone this runtime knows (`Asia/Jakarta`, `UTC`). An offset such as `+07:00`,
 * which newer runtimes also accept as a time zone, is not an IANA zone and is refused (RNX-33).
 */
export function isIanaTimeZone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
