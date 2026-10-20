/** The only back-office routes reachable without a session: they are never gated (no redirect loop). */
const PUBLIC_PATHS: readonly string[] = ["/sign-in", "/accept-invitation"];

/** True for a route the session gate lets through without asking the API. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}
