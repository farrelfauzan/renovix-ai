-- RNX-352: email_jobs.claimed_until is the end of the lease a claim takes on a job it marks "sending". A job still in
-- "sending" after its lease has ended (the container that claimed it died before marking it sent or failed) is claimed
-- again, as one more attempt. Nullable timestamptz, no default; markSent and markFailed set it back to null.
-- Changes no data: the column is null on every existing row (a "sending" row without a lease is claimed again once one
-- lease has passed since its updatedAt, see EmailJobService.claimPendingJobs).
-- No new index: the claim reads "sending" rows through the leading status column of the existing
-- email_jobs_status_next_attempt_at_idx, and only a few rows are ever in "sending" at once.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual; run it with the RNX-352 code gone, which reads the column):
-- BEGIN;
-- ALTER TABLE "email_jobs" DROP COLUMN "claimed_until";
-- COMMIT;
BEGIN;

-- AlterTable
ALTER TABLE "email_jobs" ADD COLUMN     "claimed_until" TIMESTAMPTZ;

COMMIT;
