/** What the buyer sees of an order (RNX-35): its status, or unmatched when a payment came in that did not match it. */
export type BuyerOrderState = "pending" | "paid" | "expired" | "cancelled" | "failed" | "unmatched";
