import { ADMIN_COOKIES } from "../config/admin-cookies";
import { buildCookie } from "./build-cookie";

/** The Set-Cookie values that remove both session cookies (sign-out). */
export function buildClearedSessionCookies(): string[] {
  return [
    buildCookie({ name: ADMIN_COOKIES.access, value: "", path: "/", maxAgeSeconds: 0 }),
    buildCookie({ name: ADMIN_COOKIES.refresh, value: "", path: ADMIN_COOKIES.refreshPath, maxAgeSeconds: 0 }),
  ];
}
