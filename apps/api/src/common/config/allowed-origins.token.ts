/**
 * Injection token of the origins the API accepts (RNX-272): `resolveCorsOrigins(process.env)`, the same list as
 * main.ts's CORS, provided by AccessModule for UserOriginGuard. `true` when CORS_ORIGIN is unset (every origin).
 */
export const ALLOWED_ORIGINS = Symbol("ALLOWED_ORIGINS");
