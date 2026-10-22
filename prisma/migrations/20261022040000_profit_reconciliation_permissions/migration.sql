-- RNX-228: the staff permissions `profit:read` and `reconciliation:write`, the daily usage aggregates and the provider
-- reconciliation entries.
-- Data rewritten: the `permissions` array of the built-in roles owner and finance (two permissions appended). Nothing else
-- existing is changed: three new rollup tables, one new entry table, one partial index on credit_ledger_entries.
-- The CREATE statements are from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
BEGIN;

-- Grant `profit:read` and `reconciliation:write` to the built-in roles owner and finance only (RNX-228). Keyed by the
-- role's name (never by id), as 20261015200000_audit_read_permission does; a role that already holds a permission is
-- left as it is. Custom roles and the other built-in roles are not touched.
-- The test helper seedAdminRoles runs these same statements after the baseline INSERT.
UPDATE "admin_roles"
SET "permissions" = array_append(COALESCE("permissions", ARRAY[]::text[]), 'profit:read'), "updated_at" = CURRENT_TIMESTAMP
WHERE "built_in" = true
  AND "name" IN ('owner', 'finance')
  AND NOT ('profit:read' = ANY(COALESCE("permissions", ARRAY[]::text[])));

UPDATE "admin_roles"
SET "permissions" = array_append(COALESCE("permissions", ARRAY[]::text[]), 'reconciliation:write'), "updated_at" = CURRENT_TIMESTAMP
WHERE "built_in" = true
  AND "name" IN ('owner', 'finance')
  AND NOT ('reconciliation:write' = ANY(COALESCE("permissions", ARRAY[]::text[])));

-- CreateTable
CREATE TABLE "usage_rollup_days" (
    "day" DATE NOT NULL,
    "built_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_rollup_days_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "usage_daily_rollups" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "provider_id" TEXT,
    "provider_model_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "wallet" "CreditWallet" NOT NULL,
    "workspace_id" TEXT,
    "user_id" TEXT,
    "package_version_id" TEXT,
    "top_up_pack_version_id" TEXT,
    "calls" INTEGER NOT NULL,
    "tokens_new" BIGINT NOT NULL,
    "tokens_cached" BIGINT NOT NULL,
    "tokens_out" BIGINT NOT NULL,
    "tokens_reasoning" BIGINT NOT NULL,
    "cost_low_usd" DECIMAL(30,12) NOT NULL,
    "cost_high_usd" DECIMAL(30,12) NOT NULL,
    "cost_unknown_usd_calls" INTEGER NOT NULL,
    "cost_low_idr" DECIMAL(36,12) NOT NULL,
    "cost_high_idr" DECIMAL(36,12) NOT NULL,
    "cost_unknown_idr_calls" INTEGER NOT NULL,
    "credits_consumed" DECIMAL(30,6) NOT NULL,
    "revenue_idr" DECIMAL(36,12) NOT NULL,
    "revenue_usd" DECIMAL(30,12) NOT NULL,
    "revenue_unknown_calls" INTEGER NOT NULL,
    "revenue_unknown_credits" DECIMAL(30,6) NOT NULL,

    CONSTRAINT "usage_daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_sales_daily_rollups" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "package_version_id" TEXT,
    "top_up_pack_version_id" TEXT,
    "entries" INTEGER NOT NULL,
    "credits_sold" DECIMAL(30,6) NOT NULL,
    "list_value_idr" DECIMAL(30,0) NOT NULL,
    "list_value_usd" DECIMAL(30,2) NOT NULL,

    CONSTRAINT "credit_sales_daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_reconciliation_entries" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "portal_balance_usd" DECIMAL(18,6) NOT NULL,
    "top_up_usd" DECIMAL(18,6) NOT NULL,
    "entered_by_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "provider_reconciliation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_ledger_entries_purchase_created_at_idx" ON "credit_ledger_entries"("created_at") WHERE (type = ANY (ARRAY['top_up'::"CreditEntryType", 'plan_grant'::"CreditEntryType"]));

-- CreateIndex (the credit-sales query joins a purchase entry to its snapshot by payment id)
CREATE INDEX "purchase_snapshots_payment_id_idx" ON "purchase_snapshots"("payment_id");

-- CreateIndex
CREATE INDEX "usage_daily_rollups_day_idx" ON "usage_daily_rollups"("day");

-- CreateIndex
CREATE INDEX "credit_sales_daily_rollups_day_idx" ON "credit_sales_daily_rollups"("day");

-- CreateIndex
CREATE UNIQUE INDEX "provider_reconciliation_entries_provider_id_day_key" ON "provider_reconciliation_entries"("provider_id", "day");

-- AddForeignKey
ALTER TABLE "provider_reconciliation_entries" ADD CONSTRAINT "provider_reconciliation_entries_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
