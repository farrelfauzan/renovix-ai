import type { SseCorsCheck } from "../types/sse-cors-check";

/**
 * RNX-42: the CORS headers of an SSE response, which writes its own headers (so Fastify's CORS hook never reaches it).
 * The same as the app's CORS sets on other routes (main.ts, buildCorsOptions: credentials, origin reflected only when
 * allowed): `Vary: Origin` always; `Access-Control-Allow-Origin` (that origin, never `*`) and
 * `Access-Control-Allow-Credentials` only for an allowed origin. The origin is checked against the app's allow-list,
 * never trusted from the request.
 */
export function buildSseCorsHeaders({ origin, allowedOrigins }: SseCorsCheck): Record<string, string> {
  const isAllowed = origin !== undefined && (allowedOrigins === true || allowedOrigins.includes(origin));
  if (!isAllowed) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" };
}
