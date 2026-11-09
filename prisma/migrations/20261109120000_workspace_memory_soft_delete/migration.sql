-- RNX-125: user memories, workspace memories and workspaces are soft-deleted. deleted_at and deleted_by_id mark a
-- deleted row (the row stays); deleted_by_id is a plain column (no foreign key to users).
-- Changes data: a row whose status is 'deleted' (the old way to delete a memory) gets deleted_at (its updatedAt, the
-- last change before this migration, so the time it was deleted) and status 'archived'; 'deleted' is no longer a
-- status. No code ever set a workspace's status to 'deleted', but such a row is treated the same way. deleted_by_id
-- stays null on these rows (who deleted them was never stored).
-- The column SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual; brings the old status back on every row that has deleted_at):
-- BEGIN;
-- UPDATE "user_memories" SET "status" = 'deleted' WHERE "deleted_at" IS NOT NULL;
-- UPDATE "workspace_memories" SET "status" = 'deleted' WHERE "deleted_at" IS NOT NULL;
-- UPDATE "workspaces" SET "status" = 'deleted' WHERE "deleted_at" IS NOT NULL;
-- ALTER TABLE "user_memories" DROP COLUMN "deleted_by_id", DROP COLUMN "deleted_at";
-- ALTER TABLE "workspace_memories" DROP COLUMN "deleted_by_id", DROP COLUMN "deleted_at";
-- ALTER TABLE "workspaces" DROP COLUMN "deleted_by_id", DROP COLUMN "deleted_at";
-- COMMIT;
BEGIN;

-- AlterTable
ALTER TABLE "user_memories" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by_id" TEXT;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by_id" TEXT;

-- AlterTable
ALTER TABLE "workspace_memories" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by_id" TEXT;

-- Data: status 'deleted' becomes the marker
UPDATE "user_memories" SET "deleted_at" = "updatedAt", "status" = 'archived' WHERE "status" = 'deleted';
UPDATE "workspace_memories" SET "deleted_at" = "updatedAt", "status" = 'archived' WHERE "status" = 'deleted';
UPDATE "workspaces" SET "deleted_at" = "updatedAt", "status" = 'archived' WHERE "status" = 'deleted';

COMMIT;
