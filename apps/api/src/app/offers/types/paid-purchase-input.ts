import type { PurchasePriceColumns } from "./purchase-price-columns";

/**
 * A paid checkout to record (RNX-35): the buyer, the version bought (exactly one of the two), the price as quoted and
 * charged at checkout, and the provider's reference.
 */
export type PaidPurchaseInput = {
  readonly buyerUserId: string;
  readonly packageVersionId: string | null;
  readonly topUpPackVersionId: string | null;
  readonly price: PurchasePriceColumns;
  readonly paymentId: string;
};
