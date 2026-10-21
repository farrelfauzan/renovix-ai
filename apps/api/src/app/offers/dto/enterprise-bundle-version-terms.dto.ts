import { z } from "zod";
import { CREDIT_AMOUNT } from "../config/credit-amount";

/** The amounts of one Enterprise bundle version. D1 is open: each may be null, and none has a default. */
export const EnterpriseBundleVersionTermsDto = z.strictObject({
  poolCreditsPerPeriod: CREDIT_AMOUNT.nullable(),
  /** The monthly price in US dollar cents (RNX-53, D235). */
  monthlyPriceUsdCents: z.int32().nonnegative().nullable(),
});
export type EnterpriseBundleVersionTermsDto = z.infer<typeof EnterpriseBundleVersionTermsDto>;
