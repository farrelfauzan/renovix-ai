import type { PriceListItem } from "./price-list-item";

/**
 * The public price list (RNX-53, D237): the current top-up packs and packages in rupiah, and the USD to IDR rate they
 * were converted at (the rate a purchase would be charged at now). No USD amount: no customer-facing surface shows
 * our prices in dollars.
 */
export type PriceList = {
  readonly rate: string;
  readonly rateDate: string;
  readonly source: string;
  readonly topUpPacks: readonly PriceListItem[];
  readonly packages: readonly PriceListItem[];
};
