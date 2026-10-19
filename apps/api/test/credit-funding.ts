import { randomUUID } from "node:crypto";
import { Prisma } from "@generated/prisma/client.js";
import type { PrismaService } from "../src/app/prisma/prisma.service";
import { TransactionService } from "../src/app/prisma/transaction.service";
import { CreditLedgerService } from "../src/app/billing/service/credit-ledger.service";
import { CreditAccountRepository } from "../src/app/billing/repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../src/app/billing/repository/credit-ledger-entry.repository";

/**
 * Funds a user's paid wallet through the credit ledger (RX-22: User.balance is no longer read or written by the
 * credit paths): one `bonus` entry of `amount` credits, appended by the real CreditLedgerService.
 */
export async function fundPaidWallet(prisma: PrismaService, userId: string, amount: string | number): Promise<void> {
  const ledger = new CreditLedgerService(
    new TransactionService(prisma),
    new CreditAccountRepository(prisma),
    new CreditLedgerEntryRepository(prisma),
  );
  const key = `test-funding:${randomUUID()}`;
  await ledger.appendEntry({
    owner: { userId },
    wallet: "paid",
    type: "bonus",
    amount: new Prisma.Decimal(amount),
    memberUserId: userId,
    reference: key,
    idempotencyKey: key,
  });
}
