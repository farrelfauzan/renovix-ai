import { z } from "zod";

/** RNX-121b-1: the arguments of a call_agent tool call: the name or id of the agent to call, its task and an optional context. */
export const CallAgentArgsSchema = z.object({
  agent: z.string().trim().min(1),
  task: z.string().trim().min(1),
  context: z.string().trim().optional(),
});

export type CallAgentArgsDto = z.infer<typeof CallAgentArgsSchema>;
