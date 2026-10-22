/** The states and flags the admin order list filters and counts by (RNX-35, AC19). */
export const ORDER_LIST_STATES = [
  "pending",
  "paid",
  "late",
  "expired",
  "cancelled",
  "failed",
  "unmatched",
  "amount_mismatch",
  "unconfirmed",
  "webhook_missed",
  "needs_review",
] as const;

/** One state or flag of the admin order list. */
export type OrderListState = (typeof ORDER_LIST_STATES)[number];
