import { Decimal } from "@prisma/client/runtime/client";
import type { CreditAccount } from "@generated/prisma/client.js";

/** RNX-30-A: an account's available credits, balance - held (I5); 0 without the account. */
export function availableCredits(account: Pick<CreditAccount, "balance" | "held"> | null): Decimal {
  return account ? new Decimal(account.balance).minus(account.held) : new Decimal(0);
}
