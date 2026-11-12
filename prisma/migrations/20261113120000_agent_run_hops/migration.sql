-- RNX-302: an agent run records its hops (the runs of the agents its model calls called). agent_runs.parent_run_id
-- points to the calling run (null for a top-level run; a foreign key to agent_runs with ON DELETE CASCADE, so deleting
-- a run deletes its hops), agent_runs.depth is 0 for a top-level run and the parent's depth + 1 for a hop,
-- agent_runs.parent_call_id is the ledger call id of the calling model call, agent_runs.duration_ms the hop's duration.
-- New index agent_runs_parent_run_id_idx on parent_run_id.
-- Changes no data: every existing row is a top-level run (depth 0, the other new columns null).
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual). Without parent_run_id a hop looks like a top-level run, so the first statement deletes the hops
-- (their messages go with them, ON DELETE CASCADE):
-- BEGIN;
-- DELETE FROM "agent_runs" WHERE "parent_run_id" IS NOT NULL;
-- ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_parent_run_id_fkey";
-- DROP INDEX "agent_runs_parent_run_id_idx";
-- ALTER TABLE "agent_runs" DROP COLUMN "parent_run_id", DROP COLUMN "parent_call_id", DROP COLUMN "duration_ms", DROP COLUMN "depth";
-- COMMIT;
BEGIN;

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "parent_call_id" TEXT,
ADD COLUMN     "parent_run_id" TEXT;

-- CreateIndex
CREATE INDEX "agent_runs_parent_run_id_idx" ON "agent_runs"("parent_run_id");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
