import { z } from "zod";

export const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["member"]).default("member"), // RNX-260 (D81, D237): "admin" and "viewer" are retired (400)
});

export type InviteMemberDto = z.infer<typeof InviteMemberSchema>;
