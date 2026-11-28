import { z } from "zod";
import { AuditReasonDto } from "../../admin-auth/dto/audit-reason.dto";

/** POST /admin/users/:id/reveal (RNX-357): which personal field to reveal, and why (D56): 1 to 500 characters after trimming. */
export const UserRevealBodyDto = z.strictObject({ field: z.enum(["email", "phone", "name"]), reason: AuditReasonDto });
export type UserRevealBodyDto = z.infer<typeof UserRevealBodyDto>;
