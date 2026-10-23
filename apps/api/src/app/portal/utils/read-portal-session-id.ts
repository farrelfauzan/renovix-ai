import { readCookie } from "../../admin-auth/utils/read-cookie";
import { PORTAL_SESSION_COOKIE } from "../config/portal-session-cookie";

/**
 * The portal session id a request carries (RNX-225): the `portal_session` cookie, else the `X-Portal-Session`
 * header (the fallback until the chat app sends only the cookie, RNX-49); undefined when it carries neither.
 */
export function readPortalSessionId(headers: {
  readonly cookie?: string;
  readonly "x-portal-session"?: string | string[];
}): string | undefined {
  const fromCookie = readCookie(headers.cookie, PORTAL_SESSION_COOKIE.name);
  if (fromCookie) return fromCookie;
  const fromHeader = headers["x-portal-session"];
  return typeof fromHeader === "string" && fromHeader ? fromHeader : undefined;
}
