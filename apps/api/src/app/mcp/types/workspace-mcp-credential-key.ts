import type { UserMcpCredentialKey } from "./user-mcp-credential-key";

/** An account credential looked up in one workspace (RNX-292): found only when it is switched on there. */
export type WorkspaceMcpCredentialKey = UserMcpCredentialKey & {
  readonly workspaceId: string;
};
