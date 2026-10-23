import type { PaymentOrder } from "@generated/prisma/client.js";
import type { AdminOrderView } from "../types/admin-order-view";
import { orderFlagsOf } from "./order-flags-of";

/** An order as the admin list shows it (RNX-35). */
export function toAdminOrderView(order: PaymentOrder): AdminOrderView {
  return {
    orderId: order.id,
    userId: order.userId,
    offer: order.packageVersionId ? "package" : "top_up_pack",
    provider: order.provider,
    providerRef: order.providerRef,
    amountRupiah: order.amountRupiah,
    status: order.status,
    flags: orderFlagsOf(order),
    unknownChecks: order.unknownChecks,
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    lastWebhookAt: order.lastWebhookAt?.toISOString() ?? null,
  };
}
