import { z } from "zod";

/** Six digits: the TOTP code of an authenticator app. */
const TOTP_CODE = z.string().regex(/^\d{6}$/);

/** POST /admin/auth/sign-in: email and password, plus the TOTP code or a recovery code once TOTP is enrolled. */
export const SignInDto = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
  totp: TOTP_CODE.optional(),
  recoveryCode: z.string().min(1).max(64).optional(),
});
export type SignInDto = z.infer<typeof SignInDto>;
