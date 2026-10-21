import type { PurchaseRate } from "../../exchange-rates/types/purchase-rate";
import type { PricedOffer } from "./priced-offer";

/** What the price list is built from (RNX-53): the purchase rate and the offers with their current versions. */
export type PriceListInput = {
  readonly purchaseRate: PurchaseRate;
  readonly topUpPacks: readonly PricedOffer[];
  readonly packages: readonly PricedOffer[];
};
