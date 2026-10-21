import { z } from "zod";

/** Body of POST /channels/:channelId/workspace/knowledge/search (RNX-28): the query and how many chunks to return (5 when left out). */
export const SearchWorkspaceKnowledgeSchema = z.object({
  query: z.string(),
  topK: z.number().optional(),
});
