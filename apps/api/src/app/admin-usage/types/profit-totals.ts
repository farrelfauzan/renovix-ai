import type { MoneyFigures } from "./money-figures";

/** The period's totals (RNX-228), plus the cost of the calls on a wallet other than paid, which earn no revenue. */
export type ProfitTotals = MoneyFigures & {
  readonly freeWalletCalls: number;
  readonly freeWalletCostLowUsd: string;
  readonly freeWalletCostHighUsd: string;
  readonly freeWalletCostLowIdr: string;
  readonly freeWalletCostHighIdr: string;
};
