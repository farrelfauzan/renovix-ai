-- RNX-124: agents are soft-deleted. agents.deleted_at and agents.deleted_by_id mark a deleted agent (the row stays);
-- reminders.deleted_by_id joins the existing reminders.deleted_at. deleted_by_id is a plain column on both tables
-- (no foreign key to users).
-- agents_userId_slug_key becomes a partial unique index (Prisma's partialIndexes preview feature): a slug is unique
-- per creator among live agents only, so a deleted agent's slug can be used again. Same index name as before.
-- Changes no data: the new columns are null on every existing row, and every existing row is live, so the partial
-- index holds whatever the full index held.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual; fails while two rows, one deleted, share a userId and slug):
-- BEGIN;
-- DROP INDEX "agents_userId_slug_key";
-- CREATE UNIQUE INDEX "agents_userId_slug_key" ON "agents"("userId", "slug");
-- ALTER TABLE "reminders" DROP COLUMN "deleted_by_id";
-- ALTER TABLE "agents" DROP COLUMN "deleted_by_id", DROP COLUMN "deleted_at";
-- COMMIT;
BEGIN;

-- DropIndex
DROP INDEX "agents_userId_slug_key";

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ADD COLUMN     "deleted_by_id" TEXT;

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "deleted_by_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "agents_userId_slug_key" ON "agents"("userId", "slug") WHERE (deleted_at IS NULL);

COMMIT;
