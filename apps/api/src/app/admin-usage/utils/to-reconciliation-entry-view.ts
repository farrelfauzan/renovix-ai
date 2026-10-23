import type { ProviderReconciliationEntry } from "@generated/prisma/client.js";
import type { ReconciliationEntryView } from "../types/reconciliation-entry-view";
import { toAmount } from "./to-amount";
import { toDay } from "./to-day";

/** A stored portal balance as the API shows it (RNX-228). */
export function toReconciliationEntryView(entry: ProviderReconciliationEntry): ReconciliationEntryView {
  return {
    providerId: entry.providerId,
    day: toDay(entry.day),
    portalBalanceUsd: toAmount(entry.portalBalanceUsd),
    topUpUsd: toAmount(entry.topUpUsd),
    enteredByAdminId: entry.enteredByAdminId,
  };
}
