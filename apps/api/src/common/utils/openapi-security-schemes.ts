/**
 * The security scheme objects of the generated OpenAPI documents (RX-170), keyed by the name
 * `openapi-security-scheme.ts` maps a route's accepted methods to. The staff scheme uses the real
 * back-office access cookie name (RX-94, `ADMIN_COOKIES.access`); no scheme description ever shows
 * a key or token example.
 */
import { ADMIN_COOKIES } from "../../app/admin-auth/config/admin-cookies";
import type { OpenApiSecuritySchemes } from "./openapi-security-scheme";

export const OPENAPI_SECURITY_SCHEMES: OpenApiSecuritySchemes = {
  // `Authorization: Bearer <API key>` (the legacy JWT uses the same header, so the scheme name
  // says what the caller puts in the header, not which guard checks it).
  BearerApiKey: {
    type: "apiKey",
    in: "header",
    name: "Authorization",
    description: "API key: 'Bearer ' followed by the account's API key",
  },
  // The chat portal's anonymous-or-linked session (`X-Portal-Session`, RX).
  PortalSession: {
    type: "apiKey",
    in: "header",
    name: "X-Portal-Session",
    description: "Portal session id (chat portal)",
  },
  // Signed-in product users: a legacy JWT Bearer token or a Better Auth session cookie.
  JwtOrSession: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "JWT Bearer token or Better Auth session cookie",
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
