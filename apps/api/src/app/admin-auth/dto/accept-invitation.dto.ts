import { z } from "zod";

/** POST /admin/invitations/accept: the link's token, the new admin's name and password (RX-95). The email is the invitation's. */
export const AcceptInvitationDto = z.object({
  token: z.string().min(1).max(256),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(1024),
});
export type AcceptInvitationDto = z.infer<typeof AcceptInvitationDto>;
