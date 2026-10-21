import type { PurchaseRate } from "../../exchange-rates/types/purchase-rate";
import { convertUsdCentsToRupiah } from "../../exchange-rates/utils/convert-usd-cents-to-rupiah";
import type { PriceListItem } from "../types/price-list-item";
import type { PricedOffer } from "../types/priced-offer";

/** The rupiah price list items of the offers that have a current version (RNX-53); offers without one are left out. */
export function toPriceListItems(offers: readonly PricedOffer[], purchaseRate: PurchaseRate): PriceListItem[] {
  return offers.flatMap(({ name, versions: [version] }) =>
    version ? [{ name, credits: version.creditsGranted.toNumber(), priceRupiah: convertUsdCentsToRupiah({ usdCents: version.priceUsdCents, rate: purchaseRate.rate }) }] : [],
  );
}
