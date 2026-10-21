import { z } from "zod";

/** Body of POST /chat/portal/knowledge (RNX-28): a name that is not blank (trimmed), and optionally a description. */
export const CreatePortalKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
});
