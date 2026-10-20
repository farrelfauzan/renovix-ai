import { z } from "zod";

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  avatar: z.string().max(255).optional(),
  systemPrompt: z.string().min(1).max(10000),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  isPublic: z.boolean().optional().default(false),
  agentType: z
    .enum(["standalone", "parent", "sub_agent"])
    .optional()
    .default("standalone"),
  parentAgentId: z.string().uuid().optional(),
  // RNX-203: a workspace the caller owns; the caller's default workspace when left out.
  workspaceId: z.string().uuid().optional(),
});

export type CreateAgentDto = z.infer<typeof CreateAgentSchema>;
