-- RNX-119 (D257): an agent run belongs to the person who ran it (the runner, who pays). Runs, run history, run delete
-- and the active-run lookup of a session are scoped to that person. Existing rows get the agent's creator
-- (agents."userId"), the only user an old run can be tied to; then the column is NOT NULL.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`, with
-- the ADD COLUMN made nullable first and the backfill and SET NOT NULL added by hand.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
BEGIN;

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "user_id" TEXT;

-- Backfill (hand-written): an existing run belongs to its agent's creator
UPDATE "agent_runs" SET "user_id" = "agents"."userId" FROM "agents" WHERE "agents"."id" = "agent_runs"."agentId";

-- AlterTable (hand-written)
ALTER TABLE "agent_runs" ALTER COLUMN "user_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "agent_runs_agentId_user_id_idx" ON "agent_runs"("agentId", "user_id");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
