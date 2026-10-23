import type { AdjustmentDirection } from "./adjustment-direction";

/** The form's text as typed. */
export type CreditAdjustmentFields = {
  readonly targetKind: "user" | "company";
  readonly targetId: string;
  readonly direction: AdjustmentDirection;
  readonly amount: string;
  readonly reason: string;
  readonly ticketReference: string;
  readonly paymentReference: string;
};
