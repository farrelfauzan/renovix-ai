import type { BuyerOrderState } from "./buyer-order-state";

/**
 * The buyer's own order (RNX-35): the state, the amount, until when it can be paid, when it was paid, and the payment
 * code (a QR string or URL) while it is pending. Credits are never shown on a pending order: they exist only once paid.
 */
export type BuyerOrderView = {
  readonly orderId: string;
  readonly offer: "package" | "top_up_pack";
  readonly state: BuyerOrderState;
  readonly amountRupiah: number;
  readonly expiresAt: string;
  readonly paidAt: string | null;
  readonly paymentCode: string | null;
};
