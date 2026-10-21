import { z } from "zod";

/**
 * The body of POST /agents. RNX-118: not strict, so a client that still sends the removed `agentType` and
 * `parentAgentId` has them stripped (no 400); links are made with POST /agents/:id/links.
 */
export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  avatar: z.string().max(255).optional(),
  systemPrompt: z.string().min(1).max(10000),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().int().min(1).max(128000).optional(),
  isPublic: z.boolean().optional().default(false),
  // RNX-203: a workspace the caller owns; the caller's default workspace when left out.
  workspaceId: z.string().uuid().optional(),
});

export type CreateAgentDto = z.infer<typeof CreateAgentSchema>;
