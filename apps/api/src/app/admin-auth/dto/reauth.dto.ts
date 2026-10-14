import { z } from "zod";

/** POST /admin/auth/reauth: the password and a fresh TOTP code. */
export const ReauthDto = z.object({
  password: z.string().min(1).max(1024),
  totp: z.string().regex(/^\d{6}$/),
});
export type ReauthDto = z.infer<typeof ReauthDto>;
