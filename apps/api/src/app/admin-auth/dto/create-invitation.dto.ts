import { z } from "zod";
import { PiiRevealReasonDto } from "./pii-reveal-reason.dto";

/** POST /admin/invitations: the email to invite, the role they get (RX-95) and why (RNX-370). */
export const CreateInvitationDto = z.object({
  email: z.string().email().max(320),
  role: z.string().min(1).max(64),
  reason: PiiRevealReasonDto,
});
export type CreateInvitationDto = z.infer<typeof CreateInvitationDto>;
