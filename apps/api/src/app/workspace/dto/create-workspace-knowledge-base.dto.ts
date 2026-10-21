import { z } from "zod";

/** Body of POST /channels/:channelId/workspace/knowledge (RNX-28). */
export const CreateWorkspaceKnowledgeBaseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});
