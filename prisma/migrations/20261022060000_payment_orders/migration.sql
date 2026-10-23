-- RNX-35a (D240, docs/payments.md): payment orders, their status history, the verified provider webhooks (with the
-- SHA-256 of the raw body), the payments that matched no order, and a unique index on purchase_snapshots.payment_id
-- (one snapshot per payment, replacing the non-unique one). New types, tables and indexes only, no data change.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`; the
-- CHECK on the offer columns is added by hand (Prisma does not model it).
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
BEGIN;
-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('pending', 'paid', 'expired', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "PaymentUnmatchedReason" AS ENUM ('unknown_reference', 'amount_mismatch');

-- CreateEnum
CREATE TYPE "PaymentUnmatchedStatus" AS ENUM ('open', 'refunded');

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "package_version_id" TEXT,
    "top_up_pack_version_id" TEXT,
    "price_usd_cents" INTEGER NOT NULL,
    "exchange_rate" DECIMAL(18,6) NOT NULL,
    "exchange_rate_date" DATE NOT NULL,
    "exchange_rate_source" TEXT NOT NULL,
    "amount_rupiah" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "payment_code" TEXT,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "last_webhook_at" TIMESTAMPTZ,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "is_amount_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "is_unconfirmed" BOOLEAN NOT NULL DEFAULT false,
    "is_webhook_missed" BOOLEAN NOT NULL DEFAULT false,
    "unknown_checks" INTEGER NOT NULL DEFAULT 0,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "reconcile_claimed_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_order_changes" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "from_status" "PaymentOrderStatus",
    "to_status" "PaymentOrderStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_order_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "order_id" TEXT,
    "reported_status" TEXT NOT NULL,
    "reported_amount_rupiah" INTEGER,
    "body_sha256" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_unmatched_payments" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "reason" "PaymentUnmatchedReason" NOT NULL,
    "order_id" TEXT,
    "amount_rupiah" INTEGER,
    "status" "PaymentUnmatchedStatus" NOT NULL DEFAULT 'open',
    "refunded_at" TIMESTAMPTZ,
    "refunded_by" TEXT,
    "refund_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_unmatched_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_orders_status_expires_at_idx" ON "payment_orders"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_provider_provider_ref_key" ON "payment_orders"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "payment_order_changes_order_id_created_at_idx" ON "payment_order_changes"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_provider_ref_idx" ON "payment_webhook_events"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "payment_webhook_events_received_at_idx" ON "payment_webhook_events"("received_at");

-- CreateIndex
CREATE INDEX "payment_unmatched_payments_created_at_idx" ON "payment_unmatched_payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_unmatched_payments_provider_provider_ref_key" ON "payment_unmatched_payments"("provider", "provider_ref");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_top_up_pack_version_id_fkey" FOREIGN KEY ("top_up_pack_version_id") REFERENCES "top_up_pack_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order_changes" ADD CONSTRAINT "payment_order_changes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddCheck (hand-written): an order is for exactly one offer version, a package or a top-up pack.
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_one_offer_check" CHECK (num_nonnulls("package_version_id", "top_up_pack_version_id") = 1);

-- CreateIndex: one purchase snapshot per payment (the grant's conditional update already writes one; this enforces it).
-- Several NULLs are allowed, so code redemptions (no payment id) are unaffected. It replaces RNX-228's non-unique index
-- on the same column (migration 20261022040000), which the unique index makes redundant.
DROP INDEX "purchase_snapshots_payment_id_idx";
CREATE UNIQUE INDEX "purchase_snapshots_payment_id_key" ON "purchase_snapshots"("payment_id");

COMMIT;
