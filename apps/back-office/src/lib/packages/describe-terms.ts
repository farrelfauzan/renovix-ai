import { formatUsdCents } from "./format-usd-cents";
import type { OfferKind } from "./offer-kind";
import type { OfferVersion } from "./offer-version";

const credits = (amount: string | null | undefined): string => (amount === null || amount === undefined ? "not set" : String(Number(amount)));

/** The price of a version in dollars; an Enterprise bundle's is per month. */
export function describePrice(kind: OfferKind, version: OfferVersion): string {
  return kind === "enterprise-bundle" ? `${formatUsdCents(version.monthlyPriceUsdCents)} / month` : formatUsdCents(version.priceUsdCents);
}

/** One line with the credits and, for a package, the limits and allowed tiers of a version. */
export function describeTerms(kind: OfferKind, version: OfferVersion): string {
  if (kind === "enterprise-bundle") return `${credits(version.poolCreditsPerPeriod)} pool credits per period`;
  if (kind === "top-up-pack") return `${credits(version.creditsGranted)} credits`;
  const limits = `${version.maxAgents} agents · ${version.maxConnectedTools} tools`;
  return `${credits(version.creditsGranted)} credits · ${version.billing === "monthly" ? "monthly" : "one time"} · ${limits} · ${version.apiAccess ? "API" : "no API"} · ${(version.allowedChannels ?? []).join(", ")} · tiers ${(version.allowedTiers ?? []).join(", ")}`;
}
