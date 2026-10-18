/**
 * The auth scheme of the OpenAPI documents (RX-170), derived from a route's `@Access` declaration
 * (`AccessOptions`). One scheme per accepted method; a `staff` route also says so in its description.
 */
import type { AccessOptions } from "../types/access-options";

/** A security scheme entry of an OpenAPI 3 document (only the shapes this generator emits). */
export type OpenApiSecurityScheme =
  | { readonly type: "apiKey"; readonly in: "header" | "cookie"; readonly name: string; readonly description: string }
  | { readonly type: "http"; readonly scheme: "bearer"; readonly bearerFormat: string; readonly description: string };

/** `components.securitySchemes` of a generated document: one entry per scheme the routes use. */
export type OpenApiSecuritySchemes = Readonly<Record<string, OpenApiSecurityScheme>>;

/**
 * The name of the OpenAPI security scheme a route's accepted methods map to: `public` → none;
 * `apiKey` → BearerApiKey; `portal` → PortalSession; `jwt`/`session` → JwtOrSession; `staff` →
 * BackOfficeSession.
 */
export function openApiSecuritySchemeName(access: AccessOptions | undefined): string | undefined {
  if (!access || access.public) return undefined;
  const auth = access.auth ?? [];
  if (auth.includes("apiKey")) return "BearerApiKey";
  if (auth.includes("portal")) return "PortalSession";
  if (auth.includes("staff")) return "BackOfficeSession";
  if (auth.includes("jwt") || auth.includes("session")) return "JwtOrSession";
  return undefined;
}
