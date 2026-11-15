import { randomUUID } from "node:crypto";
import { Prisma } from "@generated/prisma/client.js";
import type { PrismaService } from "../src/app/prisma/prisma.service";
import { TransactionService } from "../src/app/prisma/transaction.service";
import { CreditLedgerService } from "../src/app/billing/service/credit-ledger.service";
import { CreditAccountRepository } from "../src/app/billing/repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../src/app/billing/repository/credit-ledger-entry.repository";

/**
 * RNX-58a: funds a user's weekly_free wallet through the credit ledger, as RNX-321's weekly reset will: one
 * `weekly_reset` entry of `amount` credits, appended by the real CreditLedgerService.
 */
export async function fundWeeklyFreeWallet(prisma: PrismaService, userId: string, amount: string | number): Promise<void> {
  const ledger = new CreditLedgerService(
    new TransactionService(prisma),
    new CreditAccountRepository(prisma),
    new CreditLedgerEntryRepository(prisma),
  );
  await ledger.appendEntry({
    owner: { userId },
    wallet: "weekly_free",
    type: "weekly_reset",
    amount: new Prisma.Decimal(amount),
    memberUserId: userId,
    idempotencyKey: `test-weekly-reset:${randomUUID()}`,
  });
}
