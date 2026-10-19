import type { PrismaClient } from "@generated/prisma/client.js";

/** One credit account checked: whether each part of I1 and I2 holds for it. */
type AccountCheck = {
  id: string;
  sumMatches: boolean;
  seqGapFree: boolean;
  chainHolds: boolean;
  newestMatches: boolean;
};

/**
 * Checks I1 and I2 of docs/credits.md section 2.2 on every credit account and throws, naming each account that
 * breaks one: balance = the sum of its entries' amounts (I1); seq runs 1..n with no gap and lastSeq = n; every
 * entry's balanceAfter = the previous entry's balanceAfter + its amount, the first one's previous value being 0;
 * and the newest entry's balanceAfter = the account's balance (I2). An account with no entries must have balance 0
 * and lastSeq 0. Returns the number of accounts checked. For the tests (RX-20, RX-22); it sums entries, so it never
 * belongs in a request path.
 */
export async function assertCreditLedgerInvariants(prisma: PrismaClient): Promise<number> {
  const accounts = await prisma.$queryRaw<AccountCheck[]>`
    WITH chained AS (
      SELECT "account_id", "seq", "amount", "balance_after",
             row_number() OVER w AS "position",
             coalesce(lag("balance_after") OVER w, 0) + "amount" AS "expected_after"
      FROM "credit_ledger_entries"
      WINDOW w AS (PARTITION BY "account_id" ORDER BY "seq")
    ), per_account AS (
      SELECT "account_id", sum("amount") AS "total", max("seq") AS "last_seq",
             bool_and("seq" = "position") AS "gap_free",
             bool_and("balance_after" = "expected_after") AS "chain_holds"
      FROM chained GROUP BY "account_id"
    ), newest AS (
      SELECT DISTINCT ON ("account_id") "account_id", "balance_after"
      FROM "credit_ledger_entries" ORDER BY "account_id", "seq" DESC
    )
    SELECT a."id",
           a."balance" = coalesce(p."total", 0) AS "sumMatches",
           coalesce(p."gap_free", true) AND a."last_seq" = coalesce(p."last_seq", 0) AS "seqGapFree",
           coalesce(p."chain_holds", true) AS "chainHolds",
           a."balance" = coalesce(n."balance_after", 0) AS "newestMatches"
    FROM "credit_accounts" a
    LEFT JOIN per_account p ON p."account_id" = a."id"
    LEFT JOIN newest n ON n."account_id" = a."id"`;
  const broken = accounts.filter((a) => !(a.sumMatches && a.seqGapFree && a.chainHolds && a.newestMatches));
  if (broken.length > 0) {
    throw new Error(`Credit ledger invariants I1/I2 broken: ${JSON.stringify(broken)}`);
  }
  return accounts.length;
}
