import type { PaymentOrder } from "@generated/prisma/client.js";
import type { BuyerOrderView } from "../types/buyer-order-view";

/** The buyer's view of an order (RNX-35): a failed order whose payment did not match its amount is "unmatched"; the payment code only while pending. */
export function toBuyerOrderView(order: PaymentOrder): BuyerOrderView {
  return {
    orderId: order.id,
    offer: order.packageVersionId ? "package" : "top_up_pack",
    state: order.isAmountMismatch && order.status === "failed" ? "unmatched" : order.status,
    amountRupiah: order.amountRupiah,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    paymentCode: order.status === "pending" ? order.paymentCode : null,
  };
}
