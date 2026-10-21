import { z } from "zod";

/** Body of POST /agents/generate-prompt (RNX-28): the agent's name, and optionally its description. */
export const GeneratePromptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
