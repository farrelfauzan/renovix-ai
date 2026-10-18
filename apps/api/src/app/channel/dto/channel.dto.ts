import { z } from "zod";

export const CreateChannelSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(500).optional(),
  color: z.string().max(7).optional(),
});

export type CreateChannelDto = z.infer<typeof CreateChannelSchema>;

export const UpdateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(500).optional(),
  color: z.string().max(7).optional(),
});

export type UpdateChannelDto = z.infer<typeof UpdateChannelSchema>;

export const AddAgentSchema = z.object({
  agentId: z.string().uuid(),
  role: z.enum(["primary", "sub"]).optional().default("primary"),
});

export type AddAgentDto = z.infer<typeof AddAgentSchema>;

export const ChatMessageSchema = z.object({
  message: z.string().min(1).max(32000),
  output_format: z.enum(["pdf", "docx", "xlsx"]).optional(),
});

export type ChatMessageDto = z.infer<typeof ChatMessageSchema>;
