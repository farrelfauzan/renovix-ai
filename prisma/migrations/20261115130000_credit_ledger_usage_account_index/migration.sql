-- RNX-30-A: the credit meter sums one account's usage entries of the last 7 days and counts their distinct days (one
-- aggregate per request). This partial index (account_id, created_at) WHERE type = 'usage' serves that read; no index
-- covered it before (the (account_id, seq) unique index does not order by time).
-- Changes no data: one new index, no column or constraint.
-- The SQL is what `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script` gives
-- for the new @@index; the predicate is written as Postgres prints it, as in the schema.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration. Not CONCURRENTLY, which cannot
-- run in a transaction (nothing is deployed, D190).
-- Rollback (manual). Safe at any time; the meter's read then scans the account's entries instead:
-- BEGIN;
-- DROP INDEX "credit_ledger_entries_usage_account_id_created_at_idx";
-- COMMIT;
BEGIN;

-- CreateIndex
CREATE INDEX "credit_ledger_entries_usage_account_id_created_at_idx" ON "credit_ledger_entries"("account_id", "created_at") WHERE (type = 'usage'::"CreditEntryType");

COMMIT;
