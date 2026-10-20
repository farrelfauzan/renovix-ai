import { z } from "zod";

/** Body of POST /mcp/user/connect (RNX-206): a token-based provider's env for the caller in a workspace. */
export const ConnectMcpTokenSchema = z.object({
  provider: z.string().min(1),
  workspaceId: z.uuid(),
  env: z.record(z.string(), z.string()),
});
