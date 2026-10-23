import type { ProfitTotals } from "../types/profit-totals";
import type { UsageSumRow } from "../types/usage-sum-row";
import { sumMeasures } from "./sum-measures";
import { toAmount } from "./to-amount";
import { toMoneyFigures } from "./to-money-figures";

/** The paid wallet: the only one whose calls earn revenue. */
const PAID_WALLET = "paid";

/** The period's totals of the profit rows (RNX-228), with the cost of the calls on any wallet other than paid. */
export function toProfitTotals(rows: readonly UsageSumRow[], feePercent: number | null): ProfitTotals {
  const free = sumMeasures(rows.filter((row) => row.wallet !== PAID_WALLET));
  return {
    ...toMoneyFigures(sumMeasures(rows), feePercent),
    freeWalletCalls: free.calls,
    freeWalletCostLowUsd: toAmount(free.costLowUsd),
    freeWalletCostHighUsd: toAmount(free.costHighUsd),
    freeWalletCostLowIdr: toAmount(free.costLowIdr),
    freeWalletCostHighIdr: toAmount(free.costHighIdr),
  };
}
