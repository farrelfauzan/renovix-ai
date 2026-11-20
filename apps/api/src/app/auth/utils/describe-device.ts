/** Browser markers in a user agent, most specific first (Edge and Opera also name Chrome; Chrome also names Safari). */
const BROWSERS: readonly (readonly [string, string])[] = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["Firefox/", "Firefox"],
  ["FxiOS/", "Firefox"],
  ["CriOS/", "Chrome"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];
/** System markers, most specific first (an iPhone's user agent also says "Mac OS X", Android's says "Linux"). */
const SYSTEMS: readonly (readonly [string, string])[] = [
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Android", "Android"],
  ["Windows", "Windows"],
  ["CrOS", "ChromeOS"],
  ["Mac OS X", "macOS"],
  ["Linux", "Linux"],
];
const UNKNOWN_DEVICE = "Unknown device";

/** RNX-78: a short device name for a session's user agent ("Chrome on macOS"); no location, no version numbers. */
export function describeDevice(userAgent: string | null): string {
  const browser = BROWSERS.find(([marker]) => userAgent?.includes(marker))?.[1];
  const system = SYSTEMS.find(([marker]) => userAgent?.includes(marker))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? UNKNOWN_DEVICE;
}
