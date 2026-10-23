/** What one status check did to an order (RNX-35). Only `granted` adds credits. */
export type CheckOutcome =
  | "granted"
  | "already_settled"
  | "amount_mismatch"
  | "unconfirmed"
  | "pending"
  | "expired"
  | "cancelled"
  | "unknown"
  | "needs_review"
  | "paused"
  | "no_reference";
