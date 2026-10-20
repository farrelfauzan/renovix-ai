import type { Decimal } from "@prisma/client/runtime/client";

/**
 * The pre-run estimate E_run (docs/credits.md section 13.3): (L + 1) x E_call(root) + the sum of E_call over the
 * root's linked agents, where L = min(number of linked agents, agent calls per run limit). One root call, one call
 * per linked agent and one more root call after each returns; deeper calls are not estimated (the cap bounds them).
 */
export function estimateRunCredits(rootCall: Decimal, linkedCalls: readonly Decimal[], agentCallLimit: number): Decimal {
  const rootCalls = Math.min(linkedCalls.length, agentCallLimit) + 1;
  return linkedCalls.reduce((sum, call) => sum.plus(call), rootCall.times(rootCalls));
}
