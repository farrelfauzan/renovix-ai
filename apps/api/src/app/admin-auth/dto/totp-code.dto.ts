import { z } from "zod";

/** POST /admin/auth/totp/confirm: the first code of the newly enrolled authenticator. */
export const TotpCodeDto = z.object({
  code: z.string().regex(/^\d{6}$/),
});
export type TotpCodeDto = z.infer<typeof TotpCodeDto>;
