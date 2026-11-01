/** The unique key of a stored MCP credential (RNX-140): one per user, workspace and provider. */
export type UserMcpCredentialKey = {
  readonly userId: string;
  readonly workspaceId: string;
  readonly provider: string;
};
