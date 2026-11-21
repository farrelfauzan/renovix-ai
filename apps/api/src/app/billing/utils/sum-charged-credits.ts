import { Decimal } from "@prisma/client/runtime/client";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";

/** What usage entries took from their wallets (the amounts negated, so never the uncharged part), in whole micro-credits. */
export function sumChargedCredits(entries: readonly CreditLedgerEntry[]): Decimal {
  return entries.reduce((sum, entry) => sum.plus(entry.amount.negated()), new Decimal(0));
}
