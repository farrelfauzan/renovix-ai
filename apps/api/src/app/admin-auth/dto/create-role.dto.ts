import { z } from "zod";
import { OWNER_ONLY_PERMISSIONS } from "../config/owner-only-permissions";
import { STAFF_PERMISSIONS } from "../config/staff-permissions";

/**
 * POST /admin/roles: a custom role (RNX-187). The name is lowercase (letters, digits, `_`, `-`); the
 * permissions come from STAFF_PERMISSIONS, without the Owner-only ones (no escalation).
 */
export const CreateRoleDto = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  permissions: z
    .array(z.enum(STAFF_PERMISSIONS))
    .max(STAFF_PERMISSIONS.length)
    .refine((permissions) => !permissions.some((permission) => OWNER_ONLY_PERMISSIONS.includes(permission)), {
      message: `A custom role cannot hold ${OWNER_ONLY_PERMISSIONS.join(" or ")}`,
    }),
});
export type CreateRoleDto = z.infer<typeof CreateRoleDto>;
