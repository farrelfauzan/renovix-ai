import type { Decimal } from "@prisma/client/runtime/client";

/** Ledger amounts are whole micro-credits: at most 6 decimal places (docs/credits.md section 2.3). */
const MICRO_CREDIT_DECIMALS = 6;

/** Refuses an amount that is not finite, not whole micro-credits, or below 0 (a hold or a charge is never negative). */
export function assertCreditAmount(amount: Decimal): void {
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > MICRO_CREDIT_DECIMALS) {
    throw new Error(`A credit amount must be finite, not negative and whole micro-credits, got ${amount.toString()}`);
  }
}
