import { z } from "zod";

export const UpdateMemberSchema = z.object({
  role: z.enum(["member"]).optional(), // RNX-260 (D81, D237): "admin" and "viewer" are retired (400)
  status: z.enum(["active", "removed"]).optional(),
});

export type UpdateMemberDto = z.infer<typeof UpdateMemberSchema>;
