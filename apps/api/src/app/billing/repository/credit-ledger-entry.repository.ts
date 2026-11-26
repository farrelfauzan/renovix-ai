import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { AccountTimeZone } from "../types/account-time-zone";
import type { PaidUsageSummary } from "../types/paid-usage-summary";

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
   * RNX-82: the credits each of these API keys' usage entries charged since `since`, in one grouped query (the
   * amounts are negative; each sum is returned as a positive number). A key without entries is not in the map.
   */
  async sumKeysUsageSince(apiKeyIds: readonly string[], since: Date, tx?: DbTransaction): Promise<Map<string, Prisma.Decimal>> {
    if (apiKeyIds.length === 0) return new Map();
    const rows = await (tx ?? this.prisma).creditLedgerEntry.groupBy({
      by: ["apiKeyId"],
      where: { apiKeyId: { in: [...apiKeyIds] }, type: "usage", createdAt: { gte: since } },
      _sum: { amount: true },
    });
    return new Map(rows.flatMap((row) => (row.apiKeyId && row._sum.amount ? [[row.apiKeyId, row._sum.amount.negated()] as const] : [])));
  }

  /**
   * RNX-30-A: this account's usage since `since` (see `summarizeUsageSinceByAccount`): the credits charged, as a
   * positive amount, and the number of distinct days in `timeZone` that have a charged entry; 0 and 0 without entries.
   */
  async summarizeUsageSince(accountId: string, since: Date, timeZone: string, tx?: DbTransaction): Promise<PaidUsageSummary> {
    const summaries = await this.summarizeUsageSinceByAccount([{ accountId, timeZone }], since, tx);
    return summaries.get(accountId) ?? { spent: new Prisma.Decimal(0), usageDays: 0 };
  }

  /**
   * RNX-30-A, RNX-329: each of these accounts' usage since `since`, in one aggregate through the partial index
   * credit_ledger_entries_usage_account_id_created_at_idx (account_id, created_at) WHERE type = 'usage': the credits
   * charged (the amounts are negative; returned as a positive amount) and the number of distinct days, in the account's
   * timeZone (an IANA name, sent as a parameter), that have a charged entry (amount below 0). An account without usage
   * entries is not in the map.
   */
  async summarizeUsageSinceByAccount(accounts: readonly AccountTimeZone[], since: Date, tx?: DbTransaction): Promise<Map<string, PaidUsageSummary>> {
    if (accounts.length === 0) return new Map();
    const rows = await (tx ?? this.prisma).$queryRaw<Array<{ accountId: string; spent: string; usageDays: number }>>`
      SELECT a."accountId", (-SUM(e."amount"))::text AS "spent",
             (COUNT(DISTINCT (e."created_at" AT TIME ZONE a."timeZone")::date) FILTER (WHERE e."amount" < 0))::int AS "usageDays"
      FROM unnest(${accounts.map((account) => account.accountId)}::text[], ${accounts.map((account) => account.timeZone)}::text[])
        AS a("accountId", "timeZone")
      JOIN "credit_ledger_entries" e ON e."account_id" = a."accountId" AND e."type" = 'usage' AND e."created_at" >= ${since}
      GROUP BY a."accountId"`;
    return new Map(rows.map((row) => [row.accountId, { spent: new Prisma.Decimal(row.spent), usageDays: row.usageDays }] as const));
  }

  /** RNX-357: the newest `count` entries on this user's own wallets (paid and weekly free), newest first. */
  findLatestOfUser(userId: string, count: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).creditLedgerEntry.findMany({
      where: { account: { userId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: count,
      select: { id: true, wallet: true, type: true, amount: true, balanceAfter: true, createdAt: true },
    });
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
