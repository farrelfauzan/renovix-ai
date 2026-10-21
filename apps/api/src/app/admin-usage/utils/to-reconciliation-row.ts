import { Decimal } from "@prisma/client/runtime/client";
import type { ReconciliationRow } from "../types/reconciliation-row";
import type { ReconciliationRowInput } from "../types/reconciliation-row-input";
import { toAmount } from "./to-amount";
import { toReconciliationEntryView } from "./to-reconciliation-entry-view";

const HUNDRED = 100;

/** One provider record's day against our estimate (RNX-228); the definitions are on ReconciliationRow. */
export function toReconciliationRow({ entry, previous, estimate, thresholdPercent }: ReconciliationRowInput): ReconciliationRow {
  const low = estimate?.costLowUsd ?? new Decimal(0);
  const high = estimate?.costHighUsd ?? new Decimal(0);
  const drop = previous ? previous.portalBalanceUsd.plus(entry.topUpUsd).minus(entry.portalBalanceUsd) : null;
  const limit = thresholdPercent === null ? null : high.mul(new Decimal(thresholdPercent).div(HUNDRED).plus(1));
  return {
    ...toReconciliationEntryView(entry),
    previousBalanceUsd: previous ? toAmount(previous.portalBalanceUsd) : null,
    portalDropUsd: drop ? toAmount(drop) : null,
    estimateLowUsd: toAmount(low),
    estimateHighUsd: toAmount(high),
    costUnknownCalls: estimate?.costUnknownUsdCalls ?? 0,
    flagged: drop && limit ? drop.greaterThan(limit) : null,
  };
}
