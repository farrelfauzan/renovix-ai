import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `credit_ledger_entries` (RX-20). Entries are only ever inserted: the database refuses UPDATE and
 * DELETE (trigger, I7). The insert takes the transaction, required; the read takes it optionally.
 */
@Injectable()
export class CreditLedgerEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The entry with this idempotency key on this account, if there is one (I8). */
  findEntryByIdempotencyKey(accountId: string, idempotencyKey: string, tx?: DbTransaction): Promise<CreditLedgerEntry | null> {
    return (tx ?? this.prisma).creditLedgerEntry.findUnique({
      where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
    });
  }

  /**
   * RNX-232: the credits this API key's usage entries charged since `since` (the amounts are negative; the sum is
   * returned as a positive number, 0 without entries), through the (apiKeyId, createdAt) index.
   */
  async sumKeyUsageSince(apiKeyId: string, since: Date, tx?: DbTransaction): Promise<Prisma.Decimal> {
    const { _sum } = await (tx ?? this.prisma).creditLedgerEntry.aggregate({
      where: { apiKeyId, type: "usage", createdAt: { gte: since } },
      _sum: { amount: true },
    });
    return (_sum.amount ?? new Prisma.Decimal(0)).negated();
  }

  /**
   * Inserts an entry. A 409 when a unique key is taken: its call already has a usage entry (I3), or its seq or
   * idempotency key is already on the account.
   */
  async createEntry(data: Prisma.CreditLedgerEntryUncheckedCreateInput, tx: DbTransaction): Promise<CreditLedgerEntry> {
    try {
      return await tx.creditLedgerEntry.create({ data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("This ledger entry conflicts with an existing one");
      }
      throw err;
    }
  }
}
