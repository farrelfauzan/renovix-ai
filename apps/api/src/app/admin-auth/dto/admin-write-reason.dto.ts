import { z } from "zod";
import { PiiRevealReasonDto } from "./pii-reveal-reason.dto";

/**
 * The body of an admin write that takes nothing but its reason (RNX-370): suspend, reactivate, MFA reset, forced
 * password reset, invitation resend and revoke, role delete. Required, 1 to 500 characters after trimming.
 */
export const AdminWriteReasonDto = z.object({ reason: PiiRevealReasonDto });
export type AdminWriteReasonDto = z.infer<typeof AdminWriteReasonDto>;
