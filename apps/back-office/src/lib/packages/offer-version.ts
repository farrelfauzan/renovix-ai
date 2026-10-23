/**
 * One version of an offer as `GET /admin/packages`, `/top-up-packs` and `/enterprise-bundles` list it (newest
 * first). Prices are US dollar cents; credit amounts are decimal strings. Only the fields of the offer's kind are set.
 */
export type OfferVersion = {
  readonly id: string;
  readonly versionNumber: number;
  readonly effectiveFrom: string;
  readonly createdBy: string;
  readonly reason: string;
  readonly priceUsdCents?: number;
  readonly creditsGranted?: string;
  readonly billing?: "one_time" | "monthly";
  readonly maxAgents?: number;
  readonly maxConnectedTools?: number;
  readonly apiAccess?: boolean;
  readonly allowedChannels?: readonly string[];
  readonly allowedTiers?: readonly string[];
  readonly poolCreditsPerPeriod?: string | null;
  readonly monthlyPriceUsdCents?: number | null;
};
