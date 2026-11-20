import { z } from "zod";

/** Better Auth's password limits (lib/auth.ts emailAndPassword.minPasswordLength / maxPasswordLength). */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/** RNX-78: POST /auth/password, a first password for an account that signed up with Google or GitHub. Strict. */
export const SetPasswordDto = z.strictObject({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});
export type SetPasswordDto = z.infer<typeof SetPasswordDto>;
