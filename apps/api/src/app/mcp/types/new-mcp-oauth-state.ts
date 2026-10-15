/** A started MCP OAuth flow, stored until its callback uses it or it expires (RX-151). */
export type NewMcpOAuthState = {
  readonly nonce: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly provider: string;
  readonly expiresAt: Date;
};
