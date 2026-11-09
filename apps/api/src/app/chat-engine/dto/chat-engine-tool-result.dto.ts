import { z } from "zod";

/** The contract a tool result must meet before the engine uses it: a named tool and text content. */
export const ChatEngineToolResultSchema = z.object({
  toolName: z.string().min(1),
  content: z.string(),
});
