import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";
import { REPORT_TIME_ZONE } from "../config/report-time-zone";
import type { CreditSalesRow } from "../types/credit-sales-row";
import type { UsageGrouping } from "../types/usage-grouping";
import type { UsageSumRow } from "../types/usage-sum-row";
import { toCamelCase } from "../utils/to-camel-case";

/** The camelCase name each grouping column is returned under. */
const COLUMN_ALIASES: Readonly<Record<string, string>> = {
  day: "day",
  provider_id: "providerId",
  provider_model_id: "providerModelId",
  tier: "tier",
  wallet: "wallet",
  workspace_id: "workspaceId",
  user_id: "userId",
  package_version_id: "packageVersionId",
  top_up_pack_version_id: "topUpPackVersionId",
};
/** The rollup's measure columns, summed by a read. */
const SUMMED_MEASURES = [
  "tokens_new",
  "tokens_cached",
  "tokens_out",
  "tokens_reasoning",
  "cost_low_usd",
  "cost_high_usd",
  "cost_low_idr",
  "cost_high_idr",
  "credits_consumed",
  "revenue_idr",
  "revenue_usd",
  "revenue_unknown_credits",
] as const;
/** The rollup's count columns, summed by a read. */
const SUMMED_COUNTS = ["calls", "cost_unknown_usd_calls", "cost_unknown_idr_calls", "revenue_unknown_calls"] as const;
const ROLLUP_COLUMNS = Object.keys(COLUMN_ALIASES).filter((column) => column !== "day");
/** How long building one day may take, in ms: above Prisma's 5-second default for a busy day. */
const BUILD_DAY_TIMEOUT_MS = 120_000;
/** The first key of the rollup job's advisory lock (the second is the day); any fixed int4 works. */
const ROLLUP_LOCK_KEY = 228_001;

/**
 * The daily usage, cost and revenue aggregates (RNX-228): usage_daily_rollups, credit_sales_daily_rollups and
 * usage_rollup_days, written and read with raw SQL. A day is in Asia/Jakarta. A built day is read from the rollups;
 * any other day is computed live from model_call_costs, credit_ledger_entries, credit_accounts and purchase_snapshots
 * with the same query the build uses, so both paths give the same sums.
 */
@Injectable()
export class UsageRollupRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The days of `days` (YYYY-MM-DD) that are built. */
  async findBuiltDays(days: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ day: string }[]>`
      SELECT to_char(day, 'YYYY-MM-DD') AS day FROM usage_rollup_days WHERE day = ANY(${days}::date[])`;
    return rows.map((row) => row.day);
  }

  /**
   * Closed days (before today in Asia/Jakarta) from the first call or purchase entry on that are not built yet, oldest
   * first, at most `limit`.
   */
  async findUnbuiltClosedDays(limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ day: string }[]>`
      WITH first_day AS (
        SELECT (LEAST(
          (SELECT min(created_at) FROM model_call_costs),
          (SELECT min(created_at) FROM credit_ledger_entries WHERE type IN ('top_up', 'plan_grant'))
        ) AT TIME ZONE ${REPORT_TIME_ZONE})::date AS day
      )
      SELECT to_char(d, 'YYYY-MM-DD') AS day
      FROM first_day, generate_series(first_day.day, (now() AT TIME ZONE ${REPORT_TIME_ZONE})::date - 1, interval '1 day') AS d
      WHERE NOT EXISTS (SELECT 1 FROM usage_rollup_days r WHERE r.day = d::date)
      ORDER BY d
      LIMIT ${limit}`;
    return rows.map((row) => row.day);
  }

  /**
   * Builds one closed day: its usage and credit-sales rollup rows and its usage_rollup_days row, in one transaction under
   * an advisory lock on the day, so two instances never build it twice. False when it was built already (nothing written).
   */
  buildDay(day: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${ROLLUP_LOCK_KEY}::int, (${day}::date - DATE '2000-01-01'))) AS l`;
      const built = await tx.$queryRaw<{ day: Date }[]>`SELECT day FROM usage_rollup_days WHERE day = ${day}::date`;
      if (built.length > 0) return false;
      await tx.$executeRaw`
        INSERT INTO usage_daily_rollups (id, day, ${Prisma.raw(ROLLUP_COLUMNS.join(", "))}, ${Prisma.raw([...SUMMED_COUNTS, ...SUMMED_MEASURES].join(", "))})
        SELECT gen_random_uuid()::text, day, ${Prisma.raw(ROLLUP_COLUMNS.join(", "))}, ${Prisma.raw([...SUMMED_COUNTS, ...SUMMED_MEASURES].join(", "))}
        FROM (${this.liveUsageSql([day])}) AS live`;
      await tx.$executeRaw`
        INSERT INTO credit_sales_daily_rollups (id, day, package_version_id, top_up_pack_version_id, entries, credits_sold, list_value_idr, list_value_usd)
        SELECT gen_random_uuid()::text, day, package_version_id, top_up_pack_version_id, entries, credits_sold, list_value_idr, list_value_usd
        FROM (${this.liveSalesSql([day])}) AS live`;
      await tx.$executeRaw`INSERT INTO usage_rollup_days (day) VALUES (${day}::date)`;
      return true;
    }, { timeout: BUILD_DAY_TIMEOUT_MS });
  }

  /**
   * The usage rows of `builtDays` (read from the rollups) and `liveDays` (computed from the raw rows), summed by the
   * grouping's columns.
   */
  sumUsage(builtDays: readonly string[], liveDays: readonly string[], grouping: UsageGrouping): Promise<UsageSumRow[]> {
    const groupColumns = Prisma.raw(grouping.join(", "));
    const selected = Prisma.raw(
      [
        ...grouping.map((column) => (column === "day" ? `to_char(day, 'YYYY-MM-DD') AS "day"` : `${column} AS "${COLUMN_ALIASES[column]}"`)),
        ...SUMMED_COUNTS.map((column) => `sum(${column})::int AS "${toCamelCase(column)}"`),
        ...SUMMED_MEASURES.map((column) => `sum(${column}) AS "${toCamelCase(column)}"`),
      ].join(", "),
    );
    const allColumns = Prisma.raw(["day", ...ROLLUP_COLUMNS, ...SUMMED_COUNTS, ...SUMMED_MEASURES].join(", "));
    return this.prisma.$queryRaw<UsageSumRow[]>`
      WITH usage_rows AS (
        SELECT ${allColumns} FROM usage_daily_rollups WHERE day = ANY(${builtDays}::date[])
        UNION ALL
        SELECT ${allColumns} FROM (${this.liveUsageSql(liveDays)}) AS live
      )
      SELECT ${selected} FROM usage_rows GROUP BY ${groupColumns} ORDER BY ${groupColumns}`;
  }

  /** Credits sold per day and package on `builtDays` (from the rollup) and `liveDays` (computed live). */
  sumCreditSales(builtDays: readonly string[], liveDays: readonly string[]): Promise<CreditSalesRow[]> {
    return this.prisma.$queryRaw<CreditSalesRow[]>`
      WITH sales AS (
        SELECT day, package_version_id, top_up_pack_version_id, entries, credits_sold, list_value_idr, list_value_usd
        FROM credit_sales_daily_rollups WHERE day = ANY(${builtDays}::date[])
        UNION ALL
        SELECT day, package_version_id, top_up_pack_version_id, entries, credits_sold, list_value_idr, list_value_usd
        FROM (${this.liveSalesSql(liveDays)}) AS live
      )
      SELECT to_char(day, 'YYYY-MM-DD') AS "day", package_version_id AS "packageVersionId", top_up_pack_version_id AS "topUpPackVersionId",
        sum(entries)::int AS "entries", sum(credits_sold) AS "creditsSold", sum(list_value_idr) AS "listValueIdr", sum(list_value_usd) AS "listValueUsd"
      FROM sales GROUP BY day, package_version_id, top_up_pack_version_id ORDER BY day, package_version_id, top_up_pack_version_id`;
  }

  /**
   * The usage rows of `days`, live, at the rollup's grain. A call's day is its cost row's created_at in Asia/Jakarta.
   * The usage entry is found by call_id (no foreign key). Workspace when the cost row has one, else the entry's
   * memberUserId (the runner). Revenue is priced on the paid wallet only, from the payer's latest purchase snapshot at
   * or before the usage entry (the paying account's user is the buyer); without one the call counts as revenue unknown.
   * A null USD or rupiah cost counts as cost unknown and is left out of the sums, never as 0.
   */
  private liveUsageSql(days: readonly string[]): Prisma.Sql {
    return Prisma.sql`
      WITH calls AS (
        SELECT d.day, c.provider_id, c.provider_model_id, c.tier, c.wallet, c.workspace_id,
          CASE WHEN c.workspace_id IS NULL THEN e.member_user_id END AS user_id,
          c.tokens_new, c.tokens_cached, c.tokens_out, c.tokens_reasoning,
          c.cost_low_usd, c.cost_high_usd, c.cost_low_idr, c.cost_high_idr,
          CASE WHEN c.wallet = 'paid' THEN -e.amount END AS credits,
          s.id AS snapshot_id, s.package_version_id, s.top_up_pack_version_id,
          s.price_rupiah::numeric / s.credits_granted AS idr_per_credit,
          s.price_usd_cents::numeric / 100 / s.credits_granted AS usd_per_credit
        FROM unnest(${days}::date[]) AS d(day)
        JOIN model_call_costs c
          ON c.created_at >= (d.day::timestamp AT TIME ZONE ${REPORT_TIME_ZONE})
         AND c.created_at < ((d.day + 1)::timestamp AT TIME ZONE ${REPORT_TIME_ZONE})
        LEFT JOIN credit_ledger_entries e ON e.call_id = c.call_id AND e.type = 'usage'
        LEFT JOIN credit_accounts a ON a.id = e.account_id
        LEFT JOIN LATERAL (
          SELECT p.id, p.package_version_id, p.top_up_pack_version_id, p.price_rupiah, p.price_usd_cents, p.credits_granted
          FROM purchase_snapshots p
          WHERE c.wallet = 'paid' AND p.buyer_user_id = a.user_id AND p.created_at <= e.created_at AND p.credits_granted > 0
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT 1
        ) s ON true
      )
      SELECT day, provider_id, provider_model_id, tier, wallet, workspace_id, user_id, package_version_id, top_up_pack_version_id,
        count(*)::int AS calls,
        count(*) FILTER (WHERE cost_low_usd IS NULL OR cost_high_usd IS NULL)::int AS cost_unknown_usd_calls,
        count(*) FILTER (WHERE cost_low_idr IS NULL OR cost_high_idr IS NULL)::int AS cost_unknown_idr_calls,
        count(*) FILTER (WHERE wallet = 'paid' AND snapshot_id IS NULL)::int AS revenue_unknown_calls,
        sum(tokens_new)::numeric AS tokens_new,
        sum(tokens_cached)::numeric AS tokens_cached,
        sum(tokens_out)::numeric AS tokens_out,
        COALESCE(sum(tokens_reasoning), 0)::numeric AS tokens_reasoning,
        COALESCE(sum(cost_low_usd) FILTER (WHERE cost_low_usd IS NOT NULL AND cost_high_usd IS NOT NULL), 0) AS cost_low_usd,
        COALESCE(sum(cost_high_usd) FILTER (WHERE cost_low_usd IS NOT NULL AND cost_high_usd IS NOT NULL), 0) AS cost_high_usd,
        COALESCE(sum(cost_low_idr) FILTER (WHERE cost_low_idr IS NOT NULL AND cost_high_idr IS NOT NULL), 0) AS cost_low_idr,
        COALESCE(sum(cost_high_idr) FILTER (WHERE cost_low_idr IS NOT NULL AND cost_high_idr IS NOT NULL), 0) AS cost_high_idr,
        COALESCE(sum(credits) FILTER (WHERE wallet = 'paid'), 0) AS credits_consumed,
        COALESCE(sum(credits * idr_per_credit), 0) AS revenue_idr,
        COALESCE(sum(credits * usd_per_credit), 0) AS revenue_usd,
        COALESCE(sum(credits) FILTER (WHERE wallet = 'paid' AND snapshot_id IS NULL), 0) AS revenue_unknown_credits
      FROM calls
      GROUP BY day, provider_id, provider_model_id, tier, wallet, workspace_id, user_id, package_version_id, top_up_pack_version_id`;
  }

  /**
   * Credits sold on `days`, live: paid-wallet top_up and plan_grant entries whose reference is a purchase snapshot's
   * payment id, valued at the snapshot's list price (not cash). A code's grant has no snapshot and is not a sale.
   */
  private liveSalesSql(days: readonly string[]): Prisma.Sql {
    return Prisma.sql`
      SELECT d.day, p.package_version_id, p.top_up_pack_version_id, count(*)::int AS entries,
        sum(e.amount) AS credits_sold, sum(p.price_rupiah)::numeric AS list_value_idr, (sum(p.price_usd_cents)::numeric / 100) AS list_value_usd
      FROM unnest(${days}::date[]) AS d(day)
      JOIN credit_ledger_entries e
        ON e.type IN ('top_up', 'plan_grant')
       AND e.created_at >= (d.day::timestamp AT TIME ZONE ${REPORT_TIME_ZONE})
       AND e.created_at < ((d.day + 1)::timestamp AT TIME ZONE ${REPORT_TIME_ZONE})
      JOIN purchase_snapshots p ON p.payment_id = e.reference
      WHERE e.wallet = 'paid'
      GROUP BY d.day, p.package_version_id, p.top_up_pack_version_id`;
  }
}
