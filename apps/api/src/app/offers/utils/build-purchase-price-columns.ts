import type { PurchaseRate } from "../../exchange-rates/types/purchase-rate";
import { convertUsdCentsToRupiah } from "../../exchange-rates/utils/convert-usd-cents-to-rupiah";
import type { PurchasePriceColumns } from "../types/purchase-price-columns";

/** The snapshot's price columns for a version's USD price charged at this rate (RNX-53, D235). */
export function buildPurchasePriceColumns(priceUsdCents: number, purchaseRate: PurchaseRate): PurchasePriceColumns {
  return {
    priceUsdCents,
    exchangeRate: purchaseRate.rate,
    exchangeRateDate: purchaseRate.rateDate,
    exchangeRateSource: purchaseRate.source,
    priceRupiah: convertUsdCentsToRupiah({ usdCents: priceUsdCents, rate: purchaseRate.rate }),
  };
}
