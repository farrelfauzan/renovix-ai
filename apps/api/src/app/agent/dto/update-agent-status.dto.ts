import { z } from "zod";

/** Body of PATCH /agents/:id/status (RNX-28). */
export const UpdateAgentStatusSchema = z.object({
  status: z.enum(["active", "draft", "archived"]),
});
