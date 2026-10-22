import { getCookieDomain } from "../../../lib/cookie-domain";
import { PORTAL_SESSION_COOKIE } from "../config/portal-session-cookie";

/**
 * The Set-Cookie value of a new portal session (RNX-225): httpOnly, Path=/. In production SameSite=None and
 * Secure (the chat and the API are different hosts), otherwise SameSite=Lax, as lib/auth.ts's
 * defaultCookieAttributes. Domain from getCookieDomain(), the same as the Better Auth session cookie.
 */
export function buildPortalSessionCookie(sessionId: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const parts = [
    `${PORTAL_SESSION_COOKIE.name}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${isProduction ? "None" : "Lax"}`,
    `Max-Age=${PORTAL_SESSION_COOKIE.maxAgeSeconds}`,
  ];
  if (isProduction) parts.push("Secure");
  const domain = getCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}
