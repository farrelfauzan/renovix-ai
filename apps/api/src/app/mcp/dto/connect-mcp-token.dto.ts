import { z } from "zod";

/**
 * Body of POST /mcp/user/connect (RNX-206): a token-based provider's env for the caller's account. RNX-292: with
 * `workspaceId`, the connection is also switched on in that workspace.
 */
export const ConnectMcpTokenSchema = z.object({
  provider: z.string().min(1),
  workspaceId: z.uuid().optional(),
  env: z.record(z.string(), z.string()),
});
