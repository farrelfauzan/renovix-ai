import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { LedgerEntryView } from "../types/ledger-entry-view";

/** A ledger entry as the back-office user detail shows it (RNX-357): amounts as decimal strings. */
export function toLedgerEntryView(entry: Pick<CreditLedgerEntry, "id" | "wallet" | "type" | "amount" | "balanceAfter" | "createdAt">): LedgerEntryView {
  return {
    id: entry.id,
    wallet: entry.wallet,
    type: entry.type,
    amount: entry.amount.toString(),
    balanceAfter: entry.balanceAfter.toString(),
    createdAt: entry.createdAt,
  };
}
