import type { AdjustmentDirection } from "./adjustment-direction";
import type { AdjustmentTarget } from "./adjustment-target";

/** The body of POST /admin/credits/adjustments without the idempotency key; the amount is a decimal string, never a number. */
export type CreditAdjustmentInput = {
  readonly target: AdjustmentTarget;
  readonly amount: string;
  readonly direction: AdjustmentDirection;
  readonly reason: string;
  readonly ticketReference?: string;
  readonly paymentReference?: string;
};
