-- RNX-329: the run-out warning emails. credit_warnings holds one row per warning (amber, red, floor) queued for a credit
-- account in a purchase cycle; its unique (account_id, level, cycle_started_at) makes each warning go out once per cycle
-- whichever API container runs the hourly check (the check inserts ON CONFLICT DO NOTHING and queues the email in the
-- same transaction only when its insert created the row). cycle_started_at is the created_at of the account's latest
-- top_up or plan_grant entry, so a new purchase starts a new cycle with no write here.
-- account_id has no foreign key (D332): its check would lock the credit account row (FOR KEY SHARE) until the check's
-- transaction ends, and the chat's settle (SELECT ... FOR UPDATE on that row) would wait for it; credit accounts are
-- never deleted.
-- The new partial index (account_id, created_at) WHERE type IN ('top_up', 'plan_grant') serves the check's read of each
-- account's latest purchase entry; the unique index's leading account_id serves the check's read of the warnings
-- already queued in the cycle.
-- Changes no data: one new enum, one new empty table and one new index.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`; the
-- index predicate is written as Postgres prints it, as in the schema.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration. Not CONCURRENTLY, which cannot
-- run in a transaction (nothing is deployed, D190).
-- Rollback (manual; run it with the RNX-329 code gone, which reads and writes the table). It loses the record of the
-- warnings already sent, so a check run afterwards would send them again:
-- BEGIN;
-- DROP INDEX "credit_ledger_entries_purchase_account_id_created_at_idx";
-- DROP TABLE "credit_warnings";
-- DROP TYPE "CreditWarningLevel";
-- COMMIT;
BEGIN;

-- CreateEnum
CREATE TYPE "CreditWarningLevel" AS ENUM ('amber', 'red', 'floor');

-- CreateTable
CREATE TABLE "credit_warnings" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "level" "CreditWarningLevel" NOT NULL,
    "cycle_started_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_warnings_account_id_level_cycle_started_at_key" ON "credit_warnings"("account_id", "level", "cycle_started_at");

-- CreateIndex
CREATE INDEX "credit_ledger_entries_purchase_account_id_created_at_idx" ON "credit_ledger_entries"("account_id", "created_at") WHERE (type = ANY (ARRAY['top_up'::"CreditEntryType", 'plan_grant'::"CreditEntryType"]));

COMMIT;
