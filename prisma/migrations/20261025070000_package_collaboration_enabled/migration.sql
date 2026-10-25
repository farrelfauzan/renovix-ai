BEGIN;

ALTER TABLE "package_versions"
  ADD COLUMN "collaboration_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "purchase_snapshots"
  ADD COLUMN "collaboration_enabled" BOOLEAN;

COMMIT;
