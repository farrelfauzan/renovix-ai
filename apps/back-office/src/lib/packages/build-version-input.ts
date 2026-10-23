import type { OfferKind } from "./offer-kind";
import type { VersionFields } from "./version-fields";
import type { VersionInputResult } from "./version-input-result";

const CENTS_PER_DOLLAR = 100;
const toCount = (text: string): number => Number(text);
const isCount = (text: string): boolean => text.trim() !== "" && Number.isInteger(toCount(text)) && toCount(text) >= 0;

/**
 * The API's body for a new version (RNX-226) from the form: dollars become cents, a blank Enterprise amount becomes
 * null (D1 is open). Checks only what the form can know; the API's schema stays the authority.
 */
export function buildVersionInput(kind: OfferKind, fields: VersionFields): VersionInputResult {
  const isBundle = kind === "enterprise-bundle";
  const price = fields.price.trim() === "" && isBundle ? null : Math.round(Number(fields.price) * CENTS_PER_DOLLAR);
  const credits = fields.credits.trim() === "" && isBundle ? null : Number(fields.credits);
  if (price !== null && (!Number.isFinite(price) || price < 0 || fields.price.trim() === "")) return { error: "Enter the price in dollars, 0 or more." };
  if (credits !== null && (!Number.isFinite(credits) || credits < 0 || fields.credits.trim() === "")) return { error: "Enter the credits, 0 or more." };
  if (Number.isNaN(new Date(fields.effectiveFrom).getTime())) return { error: "Enter the date the version takes effect." };
  if (fields.reason.trim() === "") return { error: "Enter the reason for the change." };
  const common = { reason: fields.reason.trim(), effectiveFrom: new Date(fields.effectiveFrom).toISOString() };
  if (isBundle) return { input: { ...common, terms: { monthlyPriceUsdCents: price, poolCreditsPerPeriod: credits } } };
  if (kind === "top-up-pack") return { input: { ...common, terms: { priceUsdCents: price, creditsGranted: credits } } };
  if (!isCount(fields.maxAgents) || !isCount(fields.maxConnectedTools)) return { error: "Agents and tools are whole numbers, 0 or more." };
  if (fields.allowedTiers.length === 0) return { error: "Choose at least one allowed tier." };
  const allowedChannels = fields.allowedChannels.split(",").map((channel) => channel.trim()).filter(Boolean);
  const terms = {
    priceUsdCents: price, creditsGranted: credits, billing: fields.billing, maxAgents: toCount(fields.maxAgents),
    maxConnectedTools: toCount(fields.maxConnectedTools), apiAccess: fields.apiAccess, allowedChannels, allowedTiers: fields.allowedTiers,
  };
  return { input: { ...common, terms } };
}
