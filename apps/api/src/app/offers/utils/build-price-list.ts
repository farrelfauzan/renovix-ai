import type { PriceList } from "../types/price-list";
import type { PriceListInput } from "../types/price-list-input";
import { toPriceListItems } from "./to-price-list-items";

/**
 * The public price list (RNX-53, D237): every offer's rupiah price at the purchase rate, with the same conversion a
 * purchase uses, and the rate itself. Top-up packs are listed by credits, smallest first. No USD amount is returned.
 */
export function buildPriceList({ purchaseRate, topUpPacks, packages }: PriceListInput): PriceList {
  return {
    rate: purchaseRate.rate.toString(),
    rateDate: purchaseRate.rateDate.toISOString().slice(0, 10),
    source: purchaseRate.source,
    topUpPacks: toPriceListItems(topUpPacks, purchaseRate).sort((a, b) => a.credits - b.credits),
    packages: toPriceListItems(packages, purchaseRate),
  };
}
