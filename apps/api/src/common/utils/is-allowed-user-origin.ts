import { UserOriginCheck } from "../types/user-origin-check";

/** Methods that change nothing: never checked. */
const SAFE_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"];

/** The origin of a Referer header; undefined without one or when it is not a URL. */
function refererOrigin(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * True when a request to a cookie-authenticated user route may proceed (RNX-272): a GET, HEAD or OPTIONS always;
 * any request while the allowed list is `true` (CORS_ORIGIN unset in development or test, RNX-70); otherwise only when
 * the Origin header, or without one the origin of the Referer header, is an allowed origin. A Referer that is not
 * a URL is foreign, and a POST, PUT, PATCH or DELETE with neither header is refused (as on /admin, RX-156).
 */
export function isAllowedUserOrigin({ method, origin, referer, allowedOrigins }: UserOriginCheck): boolean {
  if (SAFE_METHODS.includes(method) || allowedOrigins === true) return true;
  const requestOrigin = origin ?? refererOrigin(referer);
  return requestOrigin !== undefined && allowedOrigins.includes(requestOrigin);
}
