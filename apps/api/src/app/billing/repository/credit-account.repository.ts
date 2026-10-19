import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { CreditAccount, CreditWallet } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import type { CreditAccountOwner } from "../types/credit-account-owner";

/**
 * The queries on `credit_accounts` (RX-20), one row per account and wallet. Every method changes or locks a
 * balance row, so every method takes the transaction, required.
 */
@Injectable()
export class CreditAccountRepository {
  /**
   * Locks the account row of this owner and wallet until the transaction ends (SELECT ... FOR UPDATE) and returns
   * it, creating it with balance 0 first when there is none. Race-safe: the insert is ON CONFLICT DO NOTHING on the
   * unique (owner, wallet), so two first uses at the same time create one row and both lock it. Raw SQL: Prisma has
   * no SELECT ... FOR UPDATE.
   */
  async lockOrCreateAccount(owner: CreditAccountOwner, wallet: CreditWallet, tx: DbTransaction): Promise<CreditAccount> {
    await tx.$executeRaw`
      INSERT INTO "credit_accounts" ("id", "user_id", "company_id", "wallet", "updated_at")
      VALUES (gen_random_uuid()::text, ${owner.userId ?? null}, ${owner.companyId ?? null}, ${wallet}::"CreditWallet", now())
      ON CONFLICT DO NOTHING`;
    const ownedBy =
      owner.userId === undefined ? Prisma.sql`"company_id" = ${owner.companyId}` : Prisma.sql`"user_id" = ${owner.userId}`;
    const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "credit_accounts" WHERE ${ownedBy} AND "wallet" = ${wallet}::"CreditWallet" FOR UPDATE`;
    return tx.creditAccount.findUniqueOrThrow({ where: { id } });
  }

  /** Sets the balance and lastSeq of an account this transaction has locked (`lockOrCreateAccount`). */
  async updateBalance(accountId: string, balance: Prisma.Decimal, lastSeq: number, tx: DbTransaction): Promise<void> {
    await tx.creditAccount.update({ where: { id: accountId }, data: { balance, lastSeq } });
  }
}
