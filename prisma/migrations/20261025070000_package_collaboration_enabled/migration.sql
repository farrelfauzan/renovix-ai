BEGIN;

-- Backup before deploy: pg_dump --format=custom --file=pre-rnx76.dump "$DATABASE_URL".
-- Rollback (only after confirming no snapshot needs the new field):
-- BEGIN; ALTER TABLE "purchase_snapshots" DROP COLUMN "collaboration_enabled";
-- ALTER TABLE "package_versions" DROP COLUMN "collaboration_enabled"; COMMIT;
-- The application intentionally has no automatic destructive down migration.

ALTER TABLE "package_versions"
  ADD COLUMN "collaboration_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "purchase_snapshots"
  ADD COLUMN "collaboration_enabled" BOOLEAN;

COMMIT;
