import type { CookieOptions } from "../types/cookie-options";

/** A back-office Set-Cookie value: always HttpOnly, Secure, SameSite=Strict, no Domain (D54). Max-Age 0 clears it. */
export function buildCookie({ name, value, path, maxAgeSeconds }: CookieOptions): string {
  return `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
