/**
 * The cookies of a request's Cookie header as name -> value (RX-152), values as sent (not decoded).
 * When a name appears more than once, its first value is kept. An absent header gives no cookies.
 */
export function parseCookieHeader(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (name && !cookies.has(name)) cookies.set(name, pair.slice(separator + 1).trim());
  }
  return cookies;
}
