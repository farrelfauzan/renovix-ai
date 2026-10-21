import { z } from "zod";
import { MODEL_TIERS } from "../config/model-tiers";
import { PLATFORM_SETTINGS } from "../config/platform-settings";
import { EnterpriseBundleVersionTermsDto } from "./enterprise-bundle-version-terms.dto";
import { EnterpriseBundleDto } from "./enterprise-bundle.dto";
import { PackageVersionTermsDto } from "./package-version-terms.dto";
import { PackageDto } from "./package.dto";
import { SubscriptionPlanSeedDto } from "./subscription-plan-seed.dto";
import { TopUpPackVersionTermsDto } from "./top-up-pack-version-terms.dto";
import { TopUpPackDto } from "./top-up-pack.dto";

/** When a version takes effect; the time of the seed run when left out. */
const EFFECTIVE_FROM = z.coerce.date().optional();

/**
 * The seed file (prisma/offers.seed.json) that the Tech Lead edits. A setting that is null or left out is
 * not written; an unknown setting name is refused. A null version writes no version. A package version
 * without allowedTiers gets defaultAllowedTiers (D111 option C: every tier on every paid package).
 */
export const OfferSeedDto = z.strictObject({
  notes: z.array(z.string()).optional(),
  reason: z.string().min(1),
  defaultAllowedTiers: z.array(z.enum(MODEL_TIERS)).min(1),
  settings: z.preprocess(
    (value) => (value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null)) : value),
    z.strictObject(PLATFORM_SETTINGS).partial(),
  ),
  packages: z.array(
    PackageDto.extend({
      version: PackageVersionTermsDto.partial({ allowedTiers: true }).extend({ effectiveFrom: EFFECTIVE_FROM }).nullable(),
    }),
  ),
  topUpPacks: z.array(TopUpPackDto.extend({ version: TopUpPackVersionTermsDto.extend({ effectiveFrom: EFFECTIVE_FROM }).nullable() })),
  enterpriseBundles: z.array(
    EnterpriseBundleDto.extend({ version: EnterpriseBundleVersionTermsDto.extend({ effectiveFrom: EFFECTIVE_FROM }).nullable() }),
  ),
  /** The legacy `subscription_plans` rows (RNX-91), upserted by slug by prisma/seed-offers.ts (no change record). */
  subscriptionPlans: z.array(SubscriptionPlanSeedDto).optional(),
});
export type OfferSeedDto = z.infer<typeof OfferSeedDto>;
