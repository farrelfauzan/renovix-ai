import { z } from "zod";

/** The body of POST /agents/:id/links (RNX-118): the agent the agent may call, in the same workspace. */
export const CreateAgentLinkSchema = z.object({
  calleeAgentId: z.string().uuid(),
});

export type CreateAgentLinkDto = z.infer<typeof CreateAgentLinkSchema>;
