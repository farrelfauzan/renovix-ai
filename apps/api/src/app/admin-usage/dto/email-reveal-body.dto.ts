import { z } from "zod";
import { PiiRevealReasonDto } from "../../admin-auth/dto/pii-reveal-reason.dto";

/** POST /admin/usage/users/:userId/email (RNX-228): why the admin reveals the user's email (D56), 1 to 500 characters. */
export const EmailRevealBodyDto = z.strictObject({ reason: PiiRevealReasonDto });
export type EmailRevealBodyDto = z.infer<typeof EmailRevealBodyDto>;
