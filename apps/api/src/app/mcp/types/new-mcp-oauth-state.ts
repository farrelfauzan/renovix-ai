/**
 * A started MCP OAuth flow, stored until its callback uses it or it expires (RX-151). RNX-292: `workspaceId` is the
 * workspace to switch the connection on in after the callback (null when the flow was not started from one).
 */
export type NewMcpOAuthState = {
  readonly nonce: string;
  readonly userId: string;
  readonly workspaceId: string | null;
  readonly provider: string;
  readonly expiresAt: Date;
};
