import type { PurchasePriceColumns } from "../../offers/types/purchase-price-columns";
import type { CheckoutLimits } from "./checkout-limits";
import type { CheckoutOffer } from "./checkout-offer";

/** An order to insert at checkout (RNX-35): the buyer, the offer, the quoted price and the limits it must stay within. */
export type NewOrderInput = {
  readonly userId: string;
  readonly offer: CheckoutOffer;
  readonly price: PurchasePriceColumns;
  readonly limits: CheckoutLimits;
};
