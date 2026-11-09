import type { UserMcpCredentialKey } from "./user-mcp-credential-key";

/** A credential to store or replace (RNX-140): its key and its env, already encrypted (`iv:tag:data`). */
export type UpsertUserMcpCredentialInput = UserMcpCredentialKey & {
  readonly envEncrypted: string;
};
