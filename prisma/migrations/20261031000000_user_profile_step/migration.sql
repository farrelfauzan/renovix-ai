BEGIN;

-- RNX-33: the profile step after first sign-in. Adds nullable columns only; existing rows keep NULL, so every
-- existing user sees the profile step once (profile_completed_at IS NULL).
-- Rollback (only after confirming nothing needs the stored answers):
-- BEGIN; ALTER TABLE "users" DROP COLUMN "profile_completed_at", DROP COLUMN "signup_goal", DROP COLUMN "country"; COMMIT;
-- The application intentionally has no automatic destructive down migration.

ALTER TABLE "users"
  ADD COLUMN "country" TEXT,
  ADD COLUMN "signup_goal" TEXT,
  ADD COLUMN "profile_completed_at" TIMESTAMPTZ;

COMMIT;
