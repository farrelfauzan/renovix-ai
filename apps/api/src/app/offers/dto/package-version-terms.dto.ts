import { z } from "zod";
import { CREDIT_AMOUNT } from "../config/credit-amount";
import { MODEL_TIERS } from "../config/model-tiers";

/** The terms of one package version (docs/credits.md section 9). Values come from the seed file, never code. */
export const PackageVersionTermsDto = z.strictObject({
  /** The price in US dollar cents (RNX-53, D235); the rupiah amount is derived from the stored exchange rate at purchase. */
  priceUsdCents: z.int32().nonnegative(),
  creditsGranted: CREDIT_AMOUNT,
  billing: z.enum(["one_time", "monthly"]),
  maxAgents: z.int32().nonnegative(),
  maxConnectedTools: z.int32().nonnegative(),
  apiAccess: z.boolean(),
  allowedChannels: z.array(z.string().min(1)),
  allowedTiers: z.array(z.enum(MODEL_TIERS)).min(1),
  collaborationEnabled: z.boolean().optional(),
});
export type PackageVersionTermsDto = z.infer<typeof PackageVersionTermsDto>;
