import { z } from "zod";

/** The body of PATCH /agents/:id. RNX-118: not strict, so the removed `agentType` and `parentAgentId` are stripped. */
export const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  avatar: z.string().max(255).optional().nullable(),
  avatarColor: z.string().max(7).optional().nullable(),
  systemPrompt: z.string().min(1).max(10000).optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128000).optional().nullable(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  isPublic: z.boolean().optional(),
});

export type UpdateAgentDto = z.infer<typeof UpdateAgentSchema>;
