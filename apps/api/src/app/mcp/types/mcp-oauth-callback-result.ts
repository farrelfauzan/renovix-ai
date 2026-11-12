/** A finished MCP OAuth callback (RNX-292): the account credential stored, and the workspace it was switched on in (null if none). */
export type McpOAuthCallbackResult = {
  readonly userId: string;
  readonly provider: string;
  readonly workspaceId: string | null;
};
