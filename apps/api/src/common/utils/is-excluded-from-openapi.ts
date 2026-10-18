/**
 * The routes that appear in NEITHER generated OpenAPI document (RX-170), with the reason each is
 * left out. Anything matched here is infra-machine traffic or a provider callback, not an API a
 * human or the product apps consume.
 */
export const OPENAPI_EXCLUDED_ROUTES: ReadonlyArray<{
  /** Matches the route's full path, `/api` prefix and version prefix included. */
  readonly pattern: RegExp;
  readonly reason: string;
}> = [
  // Provider callbacks, not for humans: the providers (Stripe, GOWA) call these with their own
  // signature verification in the handler; they are not part of either product API.
  { pattern: /^\/api\/v1\/webhooks(\/|$)/, reason: "Provider callbacks (Stripe, GOWA), not for humans: signature-verified machine traffic" },
  // Infra probes: the root `GET /` info route and `GET /health` are uptime/orchestration probes.
  // The root route composes to /api/v1 (global prefix + default version, no controller path).
  { pattern: /^\/api\/health$/, reason: "Infra probe (uptime/orchestration), not a product route" },
  { pattern: /^\/api\/v1$/, reason: "Infra probe (root info route), not a product route" },
];

/** Whether a route's full path is on the exclusion list (its reason is then the given one). */
export function isExcludedFromOpenApi(fullPath: string): string | undefined {
  const entry = OPENAPI_EXCLUDED_ROUTES.find(({ pattern }) => pattern.test(fullPath));
  return entry?.reason;
}
