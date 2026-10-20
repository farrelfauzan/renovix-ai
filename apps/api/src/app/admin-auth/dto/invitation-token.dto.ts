import { z } from "zod";

/** POST /admin/invitations/preview: the token of the invitation link (in the body, never the URL: RX-95). */
export const InvitationTokenDto = z.object({
  token: z.string().min(1).max(256),
});
export type InvitationTokenDto = z.infer<typeof InvitationTokenDto>;
