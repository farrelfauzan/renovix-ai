import { isRelaxedMode } from "./is-relaxed-mode";
import { resolveCorsOrigins } from "./resolve-cors-origins";

/**
 * The origins Better Auth trusts (RNX-277): exactly the allowed-origins list the API already uses for CORS and
 * UserOriginGuard (`resolveCorsOrigins`), read in one place. In production that list comes from CORS_ORIGIN
 * (required, RNX-70) plus ADMIN_ORIGIN, with no localhost fallback: an unset variable trusts no localhost origin.
 * In development and test, where `resolveCorsOrigins` answers `true` for an unset CORS_ORIGIN (every origin),
 * Better Auth gets the local origins a developer's apps really use (localhost:3000/4200/4201 and API_PUBLIC_URL's
 * own origin), so local sign-in still works.
 */
export function resolveTrustedOrigins(env: NodeJS.ProcessEnv): string[] {
  const allowed = resolveCorsOrigins(env);
  if (Array.isArray(allowed)) return allowed;
  if (!isRelaxedMode(env)) {
    // Unreachable today: resolveCorsOrigins throws in production when CORS_ORIGIN is unset. Kept as a hard
    // stop so a future change there can never quietly trust every origin here.
    throw new Error("trusted origins are unset in production: set CORS_ORIGIN (RNX-277)");
  }
  const local = ["http://localhost:3000", "http://localhost:4200", "http://localhost:4201"];
  const publicUrl = env.API_PUBLIC_URL?.trim();
  if (publicUrl) {
    try {
      local.push(new URL(publicUrl).origin);
    } catch {
      // An unparseable API_PUBLIC_URL: better-auth's baseURL default (localhost:3000) stays trusted.
    }
  }
  return [...new Set(local)];
}
