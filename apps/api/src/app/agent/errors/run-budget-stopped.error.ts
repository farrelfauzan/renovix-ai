import type { Decimal } from "@prisma/client/runtime/client";

/**
 * The budget stop (docs/credits.md section 13.4): the next model call of a run, root or hop, would take the run's
 * charges over its hold H. The call is not made and the whole run stops; what ran stays charged.
 */
export class RunBudgetStoppedError extends Error {
  constructor(readonly held: Decimal) {
    super(`The run stopped at its credit budget of ${held.toFixed()} credits`);
  }
}
