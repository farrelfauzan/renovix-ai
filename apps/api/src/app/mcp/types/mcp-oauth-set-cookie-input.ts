/** The Set-Cookie of an MCP OAuth flow's one-time value (RX-152); a cleared cookie has value "" and max age 0. */
export type McpOAuthSetCookieInput = {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds: number;
  readonly isProduction: boolean;
};
