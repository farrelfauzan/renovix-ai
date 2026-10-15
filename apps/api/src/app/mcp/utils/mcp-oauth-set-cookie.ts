import type { McpOAuthSetCookieInput } from "../types/mcp-oauth-set-cookie-input";

/**
 * The Set-Cookie header value for an MCP OAuth flow's one-time value (RX-152): HttpOnly,
 * SameSite=Lax, Path=/, Max-Age, and Secure in production. Never a Domain (a `__Host-` cookie may
 * not have one). Clear it with value "" and max age 0.
 */
export function mcpOAuthSetCookie(input: McpOAuthSetCookieInput): string {
  const { name, value, maxAgeSeconds, isProduction } = input;
  const parts = [`${name}=${value}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAgeSeconds}`];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}
