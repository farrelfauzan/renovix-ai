import type { PaymentOrder } from "@generated/prisma/client.js";

/** The order's flags, by name (RNX-35): late, amount_mismatch, unconfirmed, webhook_missed, needs_review. */
export function orderFlagsOf(order: PaymentOrder): string[] {
  const flags: [string, boolean][] = [
    ["late", order.isLate],
    ["amount_mismatch", order.isAmountMismatch],
    ["unconfirmed", order.isUnconfirmed],
    ["webhook_missed", order.isWebhookMissed],
    ["needs_review", order.needsReview],
  ];
  return flags.filter(([, isSet]) => isSet).map(([name]) => name);
}
