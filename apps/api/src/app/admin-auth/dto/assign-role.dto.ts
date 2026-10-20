import { z } from "zod";

/** PUT /admin/admins/:id/role: the name of the role the admin gets (RNX-187). */
export const AssignRoleDto = z.object({
  role: z.string().min(1).max(64),
});
export type AssignRoleDto = z.infer<typeof AssignRoleDto>;
