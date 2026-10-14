import { ADMIN_COOKIES } from "../config/admin-cookies";
import type { IssuedAdminSession } from "../types/issued-admin-session";
import { buildCookie } from "./build-cookie";

/** The two Set-Cookie values of a session: the access token for every path, the refresh token for the refresh route only. */
export function buildSessionCookies(session: IssuedAdminSession, accessTokenSeconds: number, now: Date): string[] {
  const refreshSeconds = Math.max(0, Math.floor((session.absoluteExpiresAt.getTime() - now.getTime()) / 1000));
  return [
    buildCookie({ name: ADMIN_COOKIES.access, value: session.accessToken, path: "/", maxAgeSeconds: accessTokenSeconds }),
    buildCookie({ name: ADMIN_COOKIES.refresh, value: session.refreshToken, path: ADMIN_COOKIES.refreshPath, maxAgeSeconds: refreshSeconds }),
  ];
}
