import { maskPersonalData } from "../../admin-auth/utils/mask-personal-data";
import type { UsageReportRow } from "../types/usage-report-row";
import type { UsageReportRowInput } from "../types/usage-report-row-input";
import { toAmount } from "./to-amount";
import { toProviderLabel } from "./to-provider-label";

/** A usage row as the usage report shows it (RNX-228): token counts and calls, the user by id with the email masked. */
export function toUsageReportRow({ row, emails }: UsageReportRowInput): UsageReportRow {
  const userId = row.userId ?? null;
  return {
    day: row.day,
    providerId: toProviderLabel(row.providerId),
    providerModelId: row.providerModelId ?? "",
    tier: row.tier ?? "",
    workspaceId: row.workspaceId ?? null,
    user: userId === null ? null : { id: userId, email: maskPersonalData(emails.get(userId) ?? null) },
    calls: row.calls,
    tokensNew: toAmount(row.tokensNew),
    tokensCached: toAmount(row.tokensCached),
    tokensOut: toAmount(row.tokensOut),
    tokensReasoning: toAmount(row.tokensReasoning),
  };
}
