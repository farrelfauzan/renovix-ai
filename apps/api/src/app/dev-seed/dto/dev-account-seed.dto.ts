import { z } from "zod";
import { CREDIT_AMOUNT } from "../../offers/config/credit-amount";
import { PackageVersionTermsDto } from "../../offers/dto/package-version-terms.dto";

/** The dev-only seed file (prisma/dev-account.seed.json): the default credits and the terms of a fallback package version. */
export const DevAccountSeedDto = z.strictObject({
  notes: z.array(z.string()).min(1),
  reason: z.string().min(1),
  defaultCredits: CREDIT_AMOUNT.positive(),
  terms: PackageVersionTermsDto,
});
export type DevAccountSeedDto = z.infer<typeof DevAccountSeedDto>;
