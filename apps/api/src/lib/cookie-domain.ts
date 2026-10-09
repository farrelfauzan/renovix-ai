/**
 * Derive the parent cookie domain from API_PUBLIC_URL.
 * e.g. "https://api.renovix.id" → ".renovix.id"
 *
 * Shared by the Better Auth session cookie (lib/auth.ts) and the email-login
 * `jwt` cookie (RX-68). Kept out of lib/auth.ts, which loads ESM-only
 * better-auth. NODE_ENV is read per call (it was a module constant).
 */
export function getCookieDomain(): string | undefined {
  if (process.env.COOKIE_DOMAIN) return process.env.COOKIE_DOMAIN;
  if (process.env.NODE_ENV !== "production") return undefined;
  try {
    const hostname = new URL(
      process.env.API_PUBLIC_URL || "http://localhost:3000",
    ).hostname;
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      // e.g. api.renovix.id → .renovix.id
      return "." + parts.slice(-2).join(".");
    }
  } catch {}
  return undefined;
}
