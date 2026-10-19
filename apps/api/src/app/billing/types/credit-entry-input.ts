import type { CreditWallet, Prisma } from "@generated/prisma/client.js";
import type { CreditAccountOwner } from "./credit-account-owner";

/**
 * One ledger entry to append (docs/credits.md section 2.1): the owner and wallet it changes, its signed amount in
 * whole micro-credits, and the entry's own fields. The account, seq and balanceAfter are set by the append.
 */
export type CreditEntryInput = Omit<
  Prisma.CreditLedgerEntryUncheckedCreateInput,
  "id" | "accountId" | "wallet" | "seq" | "balanceAfter" | "amount" | "createdAt"
> & {
  readonly owner: CreditAccountOwner;
  readonly wallet: CreditWallet;
  readonly amount: Prisma.Decimal;
};
