import { z } from "zod";

/** The body of POST /agents/clone/:templateId (RNX-203): the workspace to clone into, the caller's default when left out. */
export const CloneAgentSchema = z.object({
  workspaceId: z.string().uuid().optional(),
});

export type CloneAgentDto = z.infer<typeof CloneAgentSchema>;
