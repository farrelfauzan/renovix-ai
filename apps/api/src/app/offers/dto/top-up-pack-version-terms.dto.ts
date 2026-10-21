import { z } from "zod";
import { CREDIT_AMOUNT } from "../config/credit-amount";

/** The terms of one top-up pack version. */
export const TopUpPackVersionTermsDto = z.strictObject({
  creditsGranted: CREDIT_AMOUNT,
  /** The price in US dollar cents (RNX-53, D235); the rupiah amount is derived from the stored exchange rate at purchase. */
  priceUsdCents: z.int32().nonnegative(),
});
export type TopUpPackVersionTermsDto = z.infer<typeof TopUpPackVersionTermsDto>;
