/**
 * The header that carries the client IP (D48): CLIENT_IP_HEADER, trimmed and
 * lower-cased, or undefined when it is not set. The one place that reads it,
 * for clientIp (throttler, free-tier caps) and better-auth (RNX-168).
 */
export function readClientIpHeader(): string | undefined {
  return process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || undefined;
}
