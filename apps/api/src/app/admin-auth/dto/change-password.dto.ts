import { z } from "zod";

/** POST /admin/auth/password: the new password (RX-95, after a forced reset). */
export const ChangePasswordDto = z.object({
  newPassword: z.string().min(1).max(1024),
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordDto>;
