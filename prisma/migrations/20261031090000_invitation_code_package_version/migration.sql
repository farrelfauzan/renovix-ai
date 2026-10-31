-- RNX-251 PR A: an invitation code names the package version it grants; redeeming a "subscription" or "both" code
-- records a purchase snapshot of that version (paymentId null) instead of a user_subscriptions row. New nullable
-- column, its index and foreign key only, no data change. plan_id stays until PR B drops the legacy tables.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (only while no code names a version): BEGIN; ALTER TABLE "invitation_codes" DROP COLUMN "package_version_id"; COMMIT;
BEGIN;
-- AlterTable
ALTER TABLE "invitation_codes" ADD COLUMN     "package_version_id" TEXT;

-- CreateIndex
CREATE INDEX "invitation_codes_package_version_id_idx" ON "invitation_codes"("package_version_id");

-- AddForeignKey
ALTER TABLE "invitation_codes" ADD CONSTRAINT "invitation_codes_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
