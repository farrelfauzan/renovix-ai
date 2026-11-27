import { z } from "zod";
import { CreateRoleDto } from "./create-role.dto";

/**
 * PATCH /admin/roles/:name: a new name, a new permission list, or both (RNX-187); the rules of CreateRoleDto. The
 * reason stays required (RNX-370).
 */
export const UpdateRoleDto = CreateRoleDto.partial({ name: true, permissions: true }).refine((body) => body.name !== undefined || body.permissions !== undefined, {
  message: "Give a name or permissions",
});
export type UpdateRoleDto = z.infer<typeof UpdateRoleDto>;
