import { Injectable } from "@nestjs/common";
import type { PaymentOrder, PaymentOrderStatus, Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreatedCharge } from "../types/created-charge";
import type { OrderDayCounts } from "../types/order-day-counts";
import type { OrderListState } from "../types/order-list-state";
import type { PaidOrderUpdate } from "../types/paid-order-update";
import type { ReconcileClaim } from "../types/reconcile-claim";
import type { TimeRange } from "../types/time-range";
import type { UnknownCheckResult } from "../types/unknown-check-result";

/** The advisory lock key that serializes checkouts while the daily caps are summed and the order inserted. */
const CHECKOUT_LOCK_KEY = "payments:checkout";

/**
 * The queries on `payment_orders` (RNX-35). Every status change is one conditional update on the status it expects,
 * so a webhook, the reconciliation job (on any number of instances) and an admin can race on an order and only one
 * of them changes it.
 */
@Injectable()
export class PaymentOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Takes the checkout lock until the end of `tx`: one checkout at a time sums the daily caps and inserts. */
  async lockCheckouts(tx: DbTransaction): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${CHECKOUT_LOCK_KEY}))::text`;
  }

  /** The rupiah of the pending and paid orders created in `range`, of one user or (null) of everyone. */
  async sumOpenAmount(range: TimeRange, userId: string | null, tx: DbTransaction): Promise<number> {
    const result = await tx.paymentOrder.aggregate({
      _sum: { amountRupiah: true },
      where: { createdAt: { gte: range.start, lt: range.end }, status: { in: ["pending", "paid"] }, ...(userId ? { userId } : {}) },
    });
    return result._sum.amountRupiah ?? 0;
  }

  /** Inserts a pending order. */
  create(data: Prisma.PaymentOrderUncheckedCreateInput, tx: DbTransaction): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data });
  }

  /** Stores the provider's reference, payment code and expiry on a pending order. */
  attachCharge(id: string, charge: CreatedCharge, tx?: DbTransaction): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.update({
      where: { id },
      data: { providerRef: charge.providerRef, paymentCode: charge.paymentCode, expiresAt: charge.expiresAt },
    });
  }

  /** The order with this id, if any. */
  findById(id: string, tx?: DbTransaction): Promise<PaymentOrder | null> {
    return (tx ?? this.prisma).paymentOrder.findUnique({ where: { id } });
  }

  /** This user's order with this id; null for another user's order. */
  findForUser(id: string, userId: string): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findFirst({ where: { id, userId } });
  }

  /** The order of this provider reference, if any. */
  findByReference(provider: string, providerRef: string): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { provider_providerRef: { provider, providerRef } } });
  }

  /** Records that a verified webhook named the order now; returns the order as updated. */
  touchWebhook(id: string, at: Date): Promise<PaymentOrder> {
    return this.prisma.paymentOrder.update({ where: { id }, data: { lastWebhookAt: at } });
  }

  /**
   * Moves the order to `to` if its status is one of `from`, in one conditional update, and returns the status it had;
   * null when it had another (someone else moved it first): nothing is changed.
   */
  async moveStatus(id: string, from: readonly PaymentOrderStatus[], to: PaymentOrderStatus, tx: DbTransaction): Promise<PaymentOrderStatus | null> {
    const rows = await tx.$queryRaw<{ from_status: PaymentOrderStatus }[]>`
      WITH "before" AS (SELECT "id", "status" FROM "payment_orders" WHERE "id" = ${id} FOR UPDATE)
      UPDATE "payment_orders" AS o SET "status" = ${to}::"PaymentOrderStatus", "updated_at" = now()
      FROM "before" WHERE o."id" = "before"."id" AND "before"."status"::text = ANY(${[...from]})
      RETURNING "before"."status"::text AS "from_status"`;
    return rows[0]?.from_status ?? null;
  }

  /**
   * Marks a pending, expired or cancelled order paid, in one conditional update: paidAt, late when paid after its
   * expiry, and webhook_missed when asked and no webhook was seen. A paid answer after the provider said cancelled
   * still grants (the money arrived; review round 1). Returns the status it had; null when it was none of them.
   */
  async markPaid(update: PaidOrderUpdate, tx: DbTransaction): Promise<PaymentOrderStatus | null> {
    const { orderId, paidAt, isWebhookMissedWhenNone } = update;
    const rows = await tx.$queryRaw<{ from_status: PaymentOrderStatus }[]>`
      WITH "before" AS (SELECT "id", "status" FROM "payment_orders" WHERE "id" = ${orderId} FOR UPDATE)
      UPDATE "payment_orders" AS o SET "status" = 'paid', "paid_at" = ${paidAt}, "is_late" = ${paidAt} > o."expires_at",
        "is_webhook_missed" = ${isWebhookMissedWhenNone} AND o."last_webhook_at" IS NULL, "updated_at" = now()
      FROM "before" WHERE o."id" = "before"."id" AND "before"."status" IN ('pending', 'expired', 'cancelled')
      RETURNING "before"."status"::text AS "from_status"`;
    return rows[0]?.from_status ?? null;
  }

  /**
   * Fails a pending, expired or cancelled order with the amount_mismatch flag (a wrong-amount paid answer after the
   * provider said cancelled is recorded too; review round 1). Returns the status it had; null when it was none of them.
   */
  async markAmountMismatch(id: string, tx: DbTransaction): Promise<PaymentOrderStatus | null> {
    const rows = await tx.$queryRaw<{ from_status: PaymentOrderStatus }[]>`
      WITH "before" AS (SELECT "id", "status" FROM "payment_orders" WHERE "id" = ${id} FOR UPDATE)
      UPDATE "payment_orders" AS o SET "status" = 'failed', "is_amount_mismatch" = true, "updated_at" = now()
      FROM "before" WHERE o."id" = "before"."id" AND "before"."status" IN ('pending', 'expired', 'cancelled')
      RETURNING "before"."status"::text AS "from_status"`;
    return rows[0]?.from_status ?? null;
  }

  /** Flags a pending order unconfirmed (a webhook said paid, the status check did not); false when it was not pending or already flagged. */
  async flagUnconfirmed(id: string, tx: DbTransaction): Promise<boolean> {
    const { count } = await tx.paymentOrder.updateMany({ where: { id, status: "pending", isUnconfirmed: false }, data: { isUnconfirmed: true } });
    return count === 1;
  }

  /** Counts one more unknown answer on a pending order; at `maxUnknownChecks` it needs review. Null when it was not pending. */
  async countUnknownCheck(id: string, maxUnknownChecks: number, tx: DbTransaction): Promise<UnknownCheckResult | null> {
    const rows = await tx.$queryRaw<{ unknown_checks: number; needs_review: boolean }[]>`
      UPDATE "payment_orders" SET "unknown_checks" = "unknown_checks" + 1,
        "needs_review" = "unknown_checks" + 1 >= ${maxUnknownChecks}, "updated_at" = now()
      WHERE "id" = ${id} AND "status" = 'pending'
      RETURNING "unknown_checks", "needs_review"`;
    return rows[0] ? { unknownChecks: rows[0].unknown_checks, needsReview: rows[0].needs_review } : null;
  }

  /**
   * Claims up to `limit` of the provider's pending orders that need a status check (past their expiry, or named by a
   * webhook) and are not in review, skipping rows another instance holds (FOR UPDATE SKIP LOCKED, and the claim time).
   * A claim is not released: the row is claimable again once `reconcile_claimed_until` is before `now` (RNX-271).
   */
  async claimForReconcile(claim: ReconcileClaim): Promise<PaymentOrder[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "payment_orders" SET "reconcile_claimed_until" = ${claim.claimUntil}
      WHERE "id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "provider" = ${claim.provider} AND "status" = 'pending' AND "needs_review" = false AND "provider_ref" IS NOT NULL
          AND ("expires_at" < ${claim.now} OR "last_webhook_at" IS NOT NULL)
          AND ("reconcile_claimed_until" IS NULL OR "reconcile_claimed_until" < ${claim.now})
        ORDER BY "expires_at" LIMIT ${claim.limit} FOR UPDATE SKIP LOCKED)
      RETURNING "id"`;
    return this.prisma.paymentOrder.findMany({ where: { id: { in: rows.map((row) => row.id) } }, orderBy: { expiresAt: "asc" } });
  }

  /** The orders created in `range`, oldest first; with `state`, only those in that status or with that flag ("unmatched": none). */
  findCreatedIn(range: TimeRange, state: OrderListState | null): Promise<PaymentOrder[]> {
    const where: Record<OrderListState, Prisma.PaymentOrderWhereInput> = {
      pending: { status: "pending" },
      paid: { status: "paid" },
      expired: { status: "expired" },
      cancelled: { status: "cancelled" },
      failed: { status: "failed" },
      late: { isLate: true },
      amount_mismatch: { isAmountMismatch: true },
      unconfirmed: { isUnconfirmed: true },
      webhook_missed: { isWebhookMissed: true },
      needs_review: { needsReview: true },
      unmatched: { id: { in: [] } },
    };
    return this.prisma.paymentOrder.findMany({
      where: { ...(state ? where[state] : {}), createdAt: { gte: range.start, lt: range.end } },
      orderBy: { createdAt: "asc" },
    });
  }

  /** The orders created in `range`, counted by status and by flag (the unmatched count is the unmatched payments', not here: 0). */
  async countCreatedIn(range: TimeRange): Promise<OrderDayCounts> {
    const [row] = await this.prisma.$queryRaw<OrderDayCounts[]>`
      SELECT count(*) FILTER (WHERE "status" = 'pending')::int AS "pending",
        count(*) FILTER (WHERE "status" = 'paid')::int AS "paid",
        count(*) FILTER (WHERE "is_late")::int AS "late",
        count(*) FILTER (WHERE "status" = 'expired')::int AS "expired",
        count(*) FILTER (WHERE "status" = 'cancelled')::int AS "cancelled",
        count(*) FILTER (WHERE "status" = 'failed')::int AS "failed",
        0 AS "unmatched",
        count(*) FILTER (WHERE "is_amount_mismatch")::int AS "amount_mismatch",
        count(*) FILTER (WHERE "is_unconfirmed")::int AS "unconfirmed",
        count(*) FILTER (WHERE "is_webhook_missed")::int AS "webhook_missed",
        count(*) FILTER (WHERE "needs_review")::int AS "needs_review"
      FROM "payment_orders" WHERE "created_at" >= ${range.start} AND "created_at" < ${range.end}`;
    return row;
  }
}
