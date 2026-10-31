import { z } from "zod";

export const CreateReminderSchema = z.object({
  agentId: z.string().uuid(),
  channelId: z.string().uuid(),
  chatRoomId: z.string().uuid(),
  prompt: z.string().min(1).max(2000),
  description: z.string().max(200).optional(),
  cronExpression: z.string().min(1).max(100),
  // RNX-33: no default here; the service uses the user's saved timezone when none is given
  timezone: z.string().max(50).optional(),
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
