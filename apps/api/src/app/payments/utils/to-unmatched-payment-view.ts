import type { PaymentUnmatchedPayment } from "@generated/prisma/client.js";
import type { UnmatchedPaymentView } from "../types/unmatched-payment-view";

/** An unmatched payment as the admin list shows it (RNX-35). */
export function toUnmatchedPaymentView(payment: PaymentUnmatchedPayment): UnmatchedPaymentView {
  return {
    id: payment.id,
    provider: payment.provider,
    providerRef: payment.providerRef,
    reason: payment.reason,
    orderId: payment.orderId,
    amountRupiah: payment.amountRupiah,
    status: payment.status,
    createdAt: payment.createdAt.toISOString(),
    refundedAt: payment.refundedAt?.toISOString() ?? null,
    refundedBy: payment.refundedBy,
    refundNote: payment.refundNote,
  };
}
