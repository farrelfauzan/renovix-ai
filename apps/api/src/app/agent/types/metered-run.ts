import type { Decimal } from "@prisma/client/runtime/client";

/**
 * How a metered run ended: completed with the work's value, or budget_stopped before a model call that would have
 * gone over the hold `held` (docs/credits.md section 13.4); what ran is charged and settled either way.
 */
export type MeteredRun<T> =
  | { readonly status: "completed"; readonly value: T }
  | { readonly status: "budget_stopped"; readonly held: Decimal };
