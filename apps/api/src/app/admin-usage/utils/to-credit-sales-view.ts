import type { CreditSalesRow } from "../types/credit-sales-row";
import type { CreditSalesView } from "../types/credit-sales-view";
import { toAmount } from "./to-amount";

/** A credits-sold row as the profit report shows it (RNX-228). */
export function toCreditSalesView(row: CreditSalesRow): CreditSalesView {
  return {
    day: row.day,
    packageVersionId: row.packageVersionId,
    topUpPackVersionId: row.topUpPackVersionId,
    entries: row.entries,
    creditsSold: toAmount(row.creditsSold),
    listValueIdr: toAmount(row.listValueIdr),
    listValueUsd: toAmount(row.listValueUsd),
  };
}
