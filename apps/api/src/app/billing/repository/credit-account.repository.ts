import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { CreditAccount, CreditWallet } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreditAccountOwner } from "../types/credit-account-owner";

/**
 * The queries on `credit_accounts` (RX-20, RX-22), one row per account and wallet. Every method that changes or
 * locks a balance row takes the transaction, required; the plain read takes it optionally.
 */
@Injectable()
export class CreditAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The account row of this owner and wallet, if there is one (one row read, never a sum of entries). */
  findAccount(owner: CreditAccountOwner, wallet: CreditWallet, tx?: DbTransaction): Promise<CreditAccount | null> {
    const where =
      owner.userId === undefined
        ? { companyId_wallet: { companyId: owner.companyId, wallet } }
        : { userId_wallet: { userId: owner.userId, wallet } };
    return (tx ?? this.prisma).creditAccount.findUnique({ where });
  }

  /**
   * Adds `amount` to the held credits of this owner's wallet in one conditional update, only when the wallet is not
   * frozen and its available credits (balance - held) cover the amount (docs/credits.md section 2.2, Reserve).
   * Returns the account id, or null when no row was updated (no account, frozen, or not enough credits).
   */
  async addHold(owner: CreditAccountOwner, wallet: CreditWallet, amount: Prisma.Decimal, tx: DbTransaction): Promise<string | null> {
    const ownedBy =
      owner.userId === undefined ? Prisma.sql`"company_id" = ${owner.companyId}` : Prisma.sql`"user_id" = ${owner.userId}`;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "credit_accounts" SET "held" = "held" + ${amount}::numeric, "updated_at" = now()
      WHERE ${ownedBy} AND "wallet" = ${wallet}::"CreditWallet" AND NOT "frozen"
        AND "balance" - "held" >= ${amount}::numeric
      RETURNING "id"`;
    return rows[0]?.id ?? null;
  }

  /** Locks the account row with this id until the transaction ends (SELECT ... FOR UPDATE) and returns it. */
  async lockAccount(accountId: string, tx: DbTransaction): Promise<CreditAccount> {
    await tx.$queryRaw`SELECT "id" FROM "credit_accounts" WHERE "id" = ${accountId} FOR UPDATE`;
    return tx.creditAccount.findUniqueOrThrow({ where: { id: accountId } });
  }

  /** Sets the balance, held and lastSeq of an account this transaction has locked (`lockAccount`), after a usage entry. */
  async updateBalanceAndHeld(
    accountId: string,
    balance: Prisma.Decimal,
    held: Prisma.Decimal,
    lastSeq: number,
    tx: DbTransaction,
  ): Promise<void> {
    await tx.creditAccount.update({ where: { id: accountId }, data: { balance, held, lastSeq } });
  }

  /** Removes `amount` from the held credits of an account this transaction has locked (`lockAccount`): a release. */
  async releaseHold(accountId: string, amount: Prisma.Decimal, tx: DbTransaction): Promise<void> {
    await tx.creditAccount.update({ where: { id: accountId }, data: { held: { decrement: amount } } });
  }

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
