import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreditWarningCandidate } from "../types/credit-warning-candidate";
import type { CreditWarningRecord } from "../types/credit-warning-record";

/** RNX-329: the queries on `credit_warnings`, and the run-out warning check's read of the paid accounts to look at. */
@Injectable()
export class CreditWarningRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page, by account id after `afterAccountId` (null: from the start), of at most `limit` accounts to check:
   * user-owned `paid` wallets (never `weekly_free`, never a company pool) with at least one top_up or plan_grant entry,
   * whatever their balance (D387: a buyer at 0 still gets the floor warning), each with its balance (holds ignored, D387:
   * a hold is credit not yet spent, and most are released), its owner's email and timezone, its purchase cycle's key (its latest such
   * entry's createdAt, to the millisecond, which a JavaScript Date keeps exactly) and the warnings already queued in
   * that cycle. One query: the page is a range of the primary key (the first page starts after "", which sorts before
   * every id, so every page is the same plain range scan), the latest purchase entry through
   * credit_ledger_entries_purchase_account_id_created_at_idx, the queued warnings through the unique
   * (account_id, level, cycle_started_at) index.
   */
  findAccountsToCheck(afterAccountId: string | null, limit: number): Promise<CreditWarningCandidate[]> {
    return this.prisma.$queryRaw<CreditWarningCandidate[]>`
      SELECT a."id" AS "accountId", a."user_id" AS "userId", u."email" AS "ownerEmail", u."timezone" AS "timeZone",
             a."balance"::text AS "paidBalance", p."cycleStartedAt",
             ARRAY(SELECT w."level"::text FROM "credit_warnings" w
                   WHERE w."account_id" = a."id" AND w."cycle_started_at" = p."cycleStartedAt") AS "recordedLevels"
      FROM "credit_accounts" a
      JOIN "users" u ON u."id" = a."user_id"
      CROSS JOIN LATERAL (
        SELECT date_trunc('milliseconds', max(e."created_at")) AS "cycleStartedAt"
        FROM "credit_ledger_entries" e
        WHERE e."account_id" = a."id" AND e."type" IN ('top_up', 'plan_grant')
      ) p
      WHERE a."wallet" = 'paid'
        AND p."cycleStartedAt" IS NOT NULL
        AND a."id" > ${afterAccountId ?? ""}
      ORDER BY a."id"
      LIMIT ${limit}`;
  }

  /**
   * Records the warning unless this account already has it in this cycle (INSERT ... ON CONFLICT DO NOTHING on the
   * unique key; a concurrent insert of the same row waits for the other transaction and then inserts nothing). True only
   * when this call created the row: only then may the caller queue the email, in the same transaction.
   */
  async insertWarning(record: CreditWarningRecord, tx: DbTransaction): Promise<boolean> {
    const { count } = await tx.creditWarning.createMany({ data: [record], skipDuplicates: true });
    return count === 1;
  }
}
