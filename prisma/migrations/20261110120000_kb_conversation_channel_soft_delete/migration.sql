-- RNX-145: knowledge bases, conversations and channels are soft-deleted. deleted_at and deleted_by_id mark a deleted
-- row (the row and its children stay); deleted_by_id is a plain column (no foreign key to users).
-- No data change: no row is deleted yet (D49). No new index: every read keeps its current index (userId, workspace_id)
-- and only adds "deleted_at IS NULL".
-- The column SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual; the rows marked deleted come back as live rows):
-- BEGIN;
-- ALTER TABLE "conversations" DROP COLUMN "deleted_by_id", DROP COLUMN "deleted_at";
-- ALTER TABLE "knowledge_bases" DROP COLUMN "deleted_by_id", DROP COLUMN "deleted_at";
-- ALTER TABLE "channels" DROP COLUMN "deleted_by_id", DROP COLUMN "deleted_at";
-- COMMIT;
BEGIN;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by_id" TEXT;

-- AlterTable
ALTER TABLE "knowledge_bases" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by_id" TEXT;

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by_id" TEXT;

COMMIT;
