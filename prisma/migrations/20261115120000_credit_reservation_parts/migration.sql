-- RNX-58a: a home-chat hold on a Standard-tier model is taken from two wallets, weekly_free first, then paid. Each
-- wallet's part is its own credit_reservations row (its own account, wallet, amount held and consumed, I4 per row);
-- the paid part names the weekly_free part in the new column credit_reservations.part_of_id (a foreign key to
-- credit_reservations, ON DELETE RESTRICT), read through the new index credit_reservations_part_of_id_idx.
-- Changes no data: every existing reservation is a one-wallet hold (part_of_id null). The usage entries and their
-- partial unique index on call_id (I3) are not changed.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual). Without part_of_id a paid part looks like a separate one-wallet hold; run it when no two-wallet
-- reservation is open (or after closing them), so no hold is left without its other part:
-- BEGIN;
-- ALTER TABLE "credit_reservations" DROP CONSTRAINT "credit_reservations_part_of_id_fkey";
-- DROP INDEX "credit_reservations_part_of_id_idx";
-- ALTER TABLE "credit_reservations" DROP COLUMN "part_of_id";
-- COMMIT;
BEGIN;

-- AlterTable
ALTER TABLE "credit_reservations" ADD COLUMN     "part_of_id" TEXT;

-- CreateIndex
CREATE INDEX "credit_reservations_part_of_id_idx" ON "credit_reservations"("part_of_id");

-- AddForeignKey
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_part_of_id_fkey" FOREIGN KEY ("part_of_id") REFERENCES "credit_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
