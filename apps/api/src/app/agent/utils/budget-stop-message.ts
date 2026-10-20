import type { Decimal } from "@prisma/client/runtime/client";

/** The reply of a run that stopped at its budget (docs/credits.md section 13.4) instead of the agent's answer. */
export function budgetStopMessage(held: Decimal): string {
  return `This run stopped at its credit limit of ${held.toFixed()} credits before it could finish. The steps that ran were charged.`;
}
