import { Decimal } from "@prisma/client/runtime/client";
import type { UsageMeasures } from "../types/usage-measures";

/** The sum of the measures of `rows` (RNX-228); all zero for no rows. */
export function sumMeasures(rows: readonly UsageMeasures[]): UsageMeasures {
  const zero = new Decimal(0);
  const add = (pick: (row: UsageMeasures) => Decimal): Decimal => rows.reduce((sum, row) => sum.plus(pick(row)), zero);
  const count = (pick: (row: UsageMeasures) => number): number => rows.reduce((sum, row) => sum + pick(row), 0);
  return {
    calls: count((row) => row.calls),
    costUnknownUsdCalls: count((row) => row.costUnknownUsdCalls),
    costUnknownIdrCalls: count((row) => row.costUnknownIdrCalls),
    revenueUnknownCalls: count((row) => row.revenueUnknownCalls),
    tokensNew: add((row) => row.tokensNew),
    tokensCached: add((row) => row.tokensCached),
    tokensOut: add((row) => row.tokensOut),
    tokensReasoning: add((row) => row.tokensReasoning),
    costLowUsd: add((row) => row.costLowUsd),
    costHighUsd: add((row) => row.costHighUsd),
    costLowIdr: add((row) => row.costLowIdr),
    costHighIdr: add((row) => row.costHighIdr),
    creditsConsumed: add((row) => row.creditsConsumed),
    revenueIdr: add((row) => row.revenueIdr),
    revenueUsd: add((row) => row.revenueUsd),
    revenueUnknownCredits: add((row) => row.revenueUnknownCredits),
  };
}
