import type { OfferKind } from "./offer-kind";
import type { OfferVersion } from "./offer-version";
import type { VersionFields } from "./version-fields";

const MINUTES_TO_MS = 60_000;
const DATETIME_LOCAL_LENGTH = 16;

const toDollars = (cents: number | null | undefined): string => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));
const toCredits = (amount: string | null | undefined): string => (amount === null || amount === undefined ? "" : String(Number(amount)));

/** The form's starting values: the current version's terms (blank for a first version), effective now, no reason. */
export function toVersionFields(kind: OfferKind, current?: OfferVersion): VersionFields {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * MINUTES_TO_MS);
  return {
    price: toDollars(kind === "enterprise-bundle" ? current?.monthlyPriceUsdCents : current?.priceUsdCents),
    credits: toCredits(kind === "enterprise-bundle" ? current?.poolCreditsPerPeriod : current?.creditsGranted),
    billing: current?.billing ?? "monthly",
    maxAgents: String(current?.maxAgents ?? 0),
    maxConnectedTools: String(current?.maxConnectedTools ?? 0),
    apiAccess: current?.apiAccess ?? false,
    allowedChannels: (current?.allowedChannels ?? ["web"]).join(", "),
    allowedTiers: current?.allowedTiers ?? ["standard"],
    effectiveFrom: now.toISOString().slice(0, DATETIME_LOCAL_LENGTH),
    reason: "",
  };
}
