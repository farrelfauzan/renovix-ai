/**
 * The security scheme objects of the generated OpenAPI documents (RX-170), keyed by the name
 * `openapi-security-scheme.ts` maps a route's accepted methods to. The staff scheme uses the real
 * back-office access cookie name (RX-94, `ADMIN_COOKIES.access`); no scheme description ever shows
 * a key or token example.
 */
import { ADMIN_COOKIES } from "../../app/admin-auth/config/admin-cookies";
import { PORTAL_SESSION_COOKIE } from "../../app/portal/config/portal-session-cookie";
import type { OpenApiSecuritySchemes } from "./openapi-security-scheme";

export const OPENAPI_SECURITY_SCHEMES: OpenApiSecuritySchemes = {
  // `Authorization: Bearer <API key>`.
  BearerApiKey: {
    type: "apiKey",
    in: "header",
    name: "Authorization",
    description: "API key: 'Bearer ' followed by the account's API key",
  },
  // The chat portal's anonymous-or-linked session (RNX-225): the httpOnly `portal_session` cookie, which the API
  // sets when a portal request has none; the `X-Portal-Session` header is still read when there is no cookie.
  PortalSession: {
    type: "apiKey",
    in: "cookie",
    name: PORTAL_SESSION_COOKIE.name,
    description: "Portal session id (chat portal; set by the API when missing, http-only; X-Portal-Session header accepted as a fallback)",
  },
  // Signed-in product users (RNX-225): the Better Auth session cookie only (no JWT). In production its name has
  // the __Secure- prefix.
  SessionCookie: {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description: "Better Auth session cookie (set by sign-up/sign-in under /api/auth/better; http-only)",
  },
  // The back office's own session cookie (RX-94). The refresh cookie is http-only machinery of
  // `POST /api/v1/admin/auth/refresh`; documenting it as a scheme would suggest clients set it.
  BackOfficeSession: {
    type: "apiKey",
    in: "cookie",
    name: ADMIN_COOKIES.access,
    description: "Back-office session cookie (set by sign-in/refresh; http-only)",
  },
};
