/** A provider id that can be part of a cookie name as it is: no separators, spaces or control characters. */
const COOKIE_SAFE_PROVIDER = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The name of the cookie that holds the one-time value of a provider's MCP OAuth flow (RX-152):
 * `__Host-mcp_oauth_<provider>` in production, `mcp_oauth_<provider>` otherwise (plain-http
 * localhost cannot set a `__Host-` cookie, which needs Secure). Null when the provider id cannot be
 * part of a cookie name.
 */
export function mcpOAuthCookieName(provider: string, isProduction: boolean): string | null {
  if (!COOKIE_SAFE_PROVIDER.test(provider)) return null;
  return `${isProduction ? "__Host-" : ""}mcp_oauth_${provider}`;
}
