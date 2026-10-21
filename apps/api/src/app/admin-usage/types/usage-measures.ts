import type { Decimal } from "@prisma/client/runtime/client";

/** The summed measures of a set of calls (RNX-228). A sum over no known cost is 0; the unknown counts say how many calls it left out. */
export type UsageMeasures = {
  readonly calls: number;
  readonly costUnknownUsdCalls: number;
  readonly costUnknownIdrCalls: number;
  readonly revenueUnknownCalls: number;
  readonly tokensNew: Decimal;
  readonly tokensCached: Decimal;
  readonly tokensOut: Decimal;
  readonly tokensReasoning: Decimal;
  readonly costLowUsd: Decimal;
  readonly costHighUsd: Decimal;
  readonly costLowIdr: Decimal;
  readonly costHighIdr: Decimal;
  readonly creditsConsumed: Decimal;
  readonly revenueIdr: Decimal;
  readonly revenueUsd: Decimal;
  readonly revenueUnknownCredits: Decimal;
};
