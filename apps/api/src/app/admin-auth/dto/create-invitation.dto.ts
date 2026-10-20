import { z } from "zod";

/** POST /admin/invitations: the email to invite and the role they get (RX-95). */
export const CreateInvitationDto = z.object({
  email: z.string().email().max(320),
  role: z.string().min(1).max(64),
});
export type CreateInvitationDto = z.infer<typeof CreateInvitationDto>;
