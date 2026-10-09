import { getCookieDomain } from "../../lib/cookie-domain";

/** Lifetime of the JWT issued on email login/register, in seconds (7 days). */
export const JWT_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/**
 * httpOnly `jwt` cookie set on email login/register (RX-68), so the chat app's
 * route guard sees the user as signed in. Secure in production; Domain from
 * getCookieDomain(), the same as the Better Auth session cookie (COOKIE_DOMAIN,
 * else derived from API_PUBLIC_URL in production, else host-only).
 */
function cookie(value: string, maxAge: number): string {
  const parts = [
    `jwt=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  const domain = getCookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

export const authCookie = (token: string) =>
  cookie(token, JWT_LIFETIME_SECONDS);

export const clearedAuthCookie = () => cookie("", 0);
