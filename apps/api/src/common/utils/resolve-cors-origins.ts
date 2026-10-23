import { isRelaxedMode } from "./is-relaxed-mode";

/** The only hosts a production origin may name with plain http (a local run of the production build). */
const LOCAL_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1"];

/**
 * True when `entry` is exactly one origin (RNX-70): `https://host[:port]`, or `http://` on localhost or 127.0.0.1;
 * no path, query, fragment, trailing slash, user info, default port or `*` (it must equal its own `URL.origin`).
 */
function isValidOriginEntry(entry: string): boolean {
  if (entry.includes("*") || !URL.canParse(entry)) return false;
  const url = new URL(entry);
  if (url.origin !== entry) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTNAMES.includes(url.hostname));
}

/** Refuses (RNX-70) an empty list and any entry that is not a valid origin; the error names the bad entry. */
function assertProductionOrigins(listed: readonly string[]): void {
  if (listed.length === 0) {
    throw new Error(
      "CORS_ORIGIN is required outside development and test and lists no origin: set the comma-separated origins of the product apps, e.g. https://chat.renovix.id",
    );
  }
  const invalid = listed.find((entry) => !isValidOriginEntry(entry));
  if (invalid === undefined) return;
  throw new Error(
    `CORS_ORIGIN entry "${invalid}" is not an origin: use https://host[:port] (http only for localhost or 127.0.0.1), with no path, query, fragment, trailing slash or "*"`,
  );
}

/**
 * The origins the API accepts (CORS, and UserOriginGuard through ALLOWED_ORIGINS). `CORS_ORIGIN` (comma-separated)
 * lists the product apps; ADMIN_ORIGIN, the back-office app's own origin (RX-156, D141), is always added when the
 * list is set, so the back office can call the API. Outside development and test (RNX-70) `CORS_ORIGIN` is required
 * and every entry must be an origin (see `isValidOriginEntry`), else this throws and the API does not start; it never
 * answers `true` there. In development and test an unset `CORS_ORIGIN` still means every origin (`true`).
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv): string[] | true {
  if (isRelaxedMode(env) && !env.CORS_ORIGIN) return true;
  const listed = (env.CORS_ORIGIN ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!isRelaxedMode(env)) assertProductionOrigins(listed);
  const adminOrigin = env.ADMIN_ORIGIN?.trim();
  return adminOrigin && !listed.includes(adminOrigin) ? [...listed, adminOrigin] : listed;
}
