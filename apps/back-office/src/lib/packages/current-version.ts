import type { CatalogOffer } from "./catalog-offer";
import type { OfferVersion } from "./offer-version";

/** The version in force now: the highest number whose effective date has passed (versions come newest first). */
export function findCurrentVersion(offer: CatalogOffer, now = new Date()): OfferVersion | undefined {
  return offer.versions.find((version) => new Date(version.effectiveFrom) <= now);
}
