/**
 * A started MCP OAuth flow (RX-152): the consent URL, the flow's one-time value (signed into the
 * state, and set in the browser as a cookie) and how long the cookie lives (the state's lifetime).
 */
export type McpOAuthStart = {
  readonly authUrl: string;
  readonly oneTimeValue: string;
  readonly maxAgeSeconds: number;
};
