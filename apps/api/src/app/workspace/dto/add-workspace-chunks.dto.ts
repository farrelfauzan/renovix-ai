import { z } from "zod";

/** Body of POST /channels/:channelId/workspace/knowledge/:kbId/chunks (RNX-28). */
export const AddWorkspaceChunksSchema = z.object({
  chunks: z.array(
    z.object({
      content: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
