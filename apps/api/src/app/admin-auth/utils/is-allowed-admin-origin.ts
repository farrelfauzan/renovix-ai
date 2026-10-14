/** Methods that change nothing: allowed without an Origin header. */
const SAFE_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"];

/**
 * True when an /admin request may proceed (RX-156, D117 item 73): its Origin is exactly the back-office
 * origin, or it has no Origin and its method is GET, HEAD or OPTIONS.
 */
export function isAllowedAdminOrigin(origin: string | undefined, method: string, adminOrigin: string): boolean {
  return origin === undefined ? SAFE_METHODS.includes(method) : origin === adminOrigin;
}
