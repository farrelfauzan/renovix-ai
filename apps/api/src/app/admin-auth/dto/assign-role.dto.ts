import { z } from "zod";
import { AuditReasonDto } from "./audit-reason.dto";

/** PUT /admin/admins/:id/role: the name of the role the admin gets (RNX-187) and why (RNX-370). */
export const AssignRoleDto = z.object({
  role: z.string().min(1).max(64),
  reason: AuditReasonDto,
});
export type AssignRoleDto = z.infer<typeof AssignRoleDto>;
