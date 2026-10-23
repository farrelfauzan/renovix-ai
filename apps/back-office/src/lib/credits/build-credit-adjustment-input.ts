import type { CreditAdjustmentFields } from "./credit-adjustment-fields";
import type { CreditAdjustmentInputResult } from "./credit-adjustment-input-result";

/** The API's amount: up to 12 integer digits and 6 decimals, as text (mirrors the API's own check, which stays the source of truth). */
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/;

/** Checks the typed fields the way the API will, so the obvious mistakes are caught before a re-authentication is asked. */
export function buildCreditAdjustmentInput(fields: CreditAdjustmentFields): CreditAdjustmentInputResult {
  const targetId = fields.targetId.trim();
  const amount = fields.amount.trim();
  const reason = fields.reason.trim();
  if (!targetId) return { error: "Enter the user or company id." };
  if (!AMOUNT_PATTERN.test(amount) || !/[1-9]/.test(amount)) return { error: "Enter an amount above 0 with at most 6 decimals, for example 12.5." };
  if (!reason) return { error: "Enter the reason." };
  const ticketReference = fields.ticketReference.trim();
  const paymentReference = fields.paymentReference.trim();
  return {
    input: {
      target: fields.targetKind === "user" ? { userId: targetId } : { companyId: targetId },
      amount,
      direction: fields.direction,
      reason,
      ...(ticketReference && { ticketReference }),
      ...(paymentReference && { paymentReference }),
    },
  };
}
