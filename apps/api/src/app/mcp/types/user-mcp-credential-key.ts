/** The unique key of a stored MCP credential (RNX-292, D312): one per user and provider, for the whole account. */
export type UserMcpCredentialKey = {
  readonly userId: string;
  readonly provider: string;
};
