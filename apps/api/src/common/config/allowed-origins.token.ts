/**
 * Injection token of the origins the API accepts (RNX-272): `resolveCorsOrigins(process.env)`, the same list as
 * main.ts's CORS, provided by AccessModule for UserOriginGuard. `true` (every origin) only in development and test with
 * CORS_ORIGIN unset; elsewhere CORS_ORIGIN is required (RNX-70).
 */
export const ALLOWED_ORIGINS = Symbol("ALLOWED_ORIGINS");
