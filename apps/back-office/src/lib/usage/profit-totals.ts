import type { MoneyFigures } from "./money-figures";

/** The period's totals from the API, plus the cost of the calls on a wallet other than paid. */
export type ProfitTotals = MoneyFigures & {
  readonly freeWalletCalls: number;
  readonly freeWalletCostLowUsd: string;
  readonly freeWalletCostHighUsd: string;
  readonly freeWalletCostLowIdr: string;
  readonly freeWalletCostHighIdr: string;
};
