-- RNX-232 (18b, D47, D111): per-key limits. A key keeps the model tiers it may call (set at creation from the
-- user's package) and an optional monthly credit cap; credit reservations and ledger entries record the key they
-- were made with (ledger attribution, and the cap counts the key's month of usage plus its open holds through the
-- two new indexes). A key that exists before this migration gets an empty tier list (it may call no model; nothing
-- is deployed, D190: regenerate or create a new key). No other row is changed; the new columns of the ledger and the
-- reservations are null on existing rows.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (hand-added, D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one;
-- with BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
BEGIN;

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "allowed_tiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "monthly_credit_cap" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "credit_ledger_entries" ADD COLUMN     "api_key_id" TEXT;

-- AlterTable
ALTER TABLE "credit_reservations" ADD COLUMN     "api_key_id" TEXT;

-- CreateIndex
CREATE INDEX "credit_ledger_entries_api_key_id_created_at_idx" ON "credit_ledger_entries"("api_key_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_reservations_api_key_id_status_idx" ON "credit_reservations"("api_key_id", "status");

COMMIT;
