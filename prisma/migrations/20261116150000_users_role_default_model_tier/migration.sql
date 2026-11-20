-- RNX-77a: users.role holds the role chosen in the RNX-33 profile step and in Settings > General (the step wrote it
-- into job_title before; job_title is now optional free text), and users.default_model_tier the model tier a new chat
-- starts on (one of the model tiers; PATCH /auth/me accepts only a tier the account's packages allow). Both nullable
-- text, no default.
-- Changes no data: both columns are null on every existing row; existing job_title values are not moved (nothing is
-- deployed, D190).
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual; drops the saved roles and default tiers):
-- BEGIN;
-- ALTER TABLE "users" DROP COLUMN "default_model_tier", DROP COLUMN "role";
-- COMMIT;
BEGIN;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_model_tier" TEXT,
ADD COLUMN     "role" TEXT;

COMMIT;
