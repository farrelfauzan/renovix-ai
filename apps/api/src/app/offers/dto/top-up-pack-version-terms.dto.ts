import { z } from "zod";
import { CREDIT_AMOUNT } from "../config/credit-amount";

/** The terms of one top-up pack version. */
export const TopUpPackVersionTermsDto = z.strictObject({
  creditsGranted: CREDIT_AMOUNT,
  priceRupiah: z.int32().nonnegative(),
});
export type TopUpPackVersionTermsDto = z.infer<typeof TopUpPackVersionTermsDto>;
