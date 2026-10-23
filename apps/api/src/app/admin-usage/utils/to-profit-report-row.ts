import type { ProfitReportRow } from "../types/profit-report-row";
import type { UsageSumRow } from "../types/usage-sum-row";
import { toMoneyFigures } from "./to-money-figures";
import { toProviderLabel } from "./to-provider-label";

/** A usage row as the profit report shows it (RNX-228): its dimensions and its money figures. */
export function toProfitReportRow(row: UsageSumRow, feePercent: number | null): ProfitReportRow {
  return {
    day: row.day,
    providerId: toProviderLabel(row.providerId),
    providerModelId: row.providerModelId ?? "",
    tier: row.tier ?? "",
    wallet: row.wallet ?? "",
    packageVersionId: row.packageVersionId ?? null,
    topUpPackVersionId: row.topUpPackVersionId ?? null,
    ...toMoneyFigures(row, feePercent),
  };
}
