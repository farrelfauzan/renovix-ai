import { z } from "zod";

export const CreateReminderSchema = z.object({
  agentId: z.string().uuid(),
  channelId: z.string().uuid(),
  chatRoomId: z.string().uuid(),
  prompt: z.string().min(1).max(2000),
  description: z.string().max(200).optional(),
  cronExpression: z.string().min(1).max(100),
  timezone: z.string().max(50).optional().default("UTC"),
});

export type CreateReminderDto = z.infer<typeof CreateReminderSchema>;

export const UpdateReminderSchema = z.object({
  prompt: z.string().min(1).max(2000).optional(),
  description: z.string().max(200).optional(),
  cronExpression: z.string().min(1).max(100).optional(),
  timezone: z.string().max(50).optional(),
  status: z.enum(["ACTIVE", "PAUSED"]).optional(),
});

export type UpdateReminderDto = z.infer<typeof UpdateReminderSchema>;
