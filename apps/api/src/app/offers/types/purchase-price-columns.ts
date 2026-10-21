import type { Decimal } from "@prisma/client/runtime/client";

/** A purchase snapshot's price columns (RNX-53): the USD price, the rate it was charged at, and the rupiah amount. */
export type PurchasePriceColumns = {
  readonly priceUsdCents: number;
  readonly exchangeRate: Decimal;
  readonly exchangeRateDate: Date;
  readonly exchangeRateSource: string;
  readonly priceRupiah: number;
};
