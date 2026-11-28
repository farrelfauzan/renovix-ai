import { z } from "zod";
import { AuditReasonDto } from "../../admin-auth/dto/audit-reason.dto";

/** POST /admin/usage/users/:userId/email (RNX-228): why the admin reveals the user's email (D56), 1 to 500 characters. */
export const EmailRevealBodyDto = z.strictObject({ reason: AuditReasonDto });
export type EmailRevealBodyDto = z.infer<typeof EmailRevealBodyDto>;
