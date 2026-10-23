import type { CreditAdjustmentFields } from "./credit-adjustment-fields";

/** The form before anything is typed. */
export const EMPTY_ADJUSTMENT_FIELDS: CreditAdjustmentFields = { targetKind: "user", targetId: "", direction: "add", amount: "", reason: "", ticketReference: "", paymentReference: "" };
