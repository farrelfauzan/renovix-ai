-- RNX-118 (PRD 10, D81): agent links ("Can call") replace the parent / sub-agent model. A link lets the caller agent
-- call the callee agent in a run; both agents are in one workspace (checked by AgentLinkService, the only writer),
-- and an agent never links to itself (the CHECK; the link route also refuses it with 400). Deleting either agent
-- removes the link. Each existing parent -> sub-agent relation in one workspace is kept as a link (caller = the
-- parent, callee = the sub-agent) before agent_type and parent_agent_id are dropped; a cross-workspace relation is
-- not copied.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`,
-- reordered so the copy runs before the drops, plus the CHECK, which Prisma does not model (and so does not compare),
-- and the INSERT ... SELECT copy.
-- One explicit transaction (hand-added): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one, and a
-- statement failing after the drops was shown to leave the table created and the columns dropped. With BEGIN/COMMIT a
-- failure anywhere leaves the database as it was before the migration.
BEGIN;

-- CreateTable
CREATE TABLE "agent_links" (
    "caller_agent_id" TEXT NOT NULL,
    "callee_agent_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_links_pkey" PRIMARY KEY ("caller_agent_id","callee_agent_id"),
    CONSTRAINT "agent_links_not_self" CHECK ("caller_agent_id" <> "callee_agent_id")
);

-- CreateIndex
CREATE INDEX "agent_links_callee_agent_id_idx" ON "agent_links"("callee_agent_id");

-- AddForeignKey
ALTER TABLE "agent_links" ADD CONSTRAINT "agent_links_caller_agent_id_fkey" FOREIGN KEY ("caller_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_links" ADD CONSTRAINT "agent_links_callee_agent_id_fkey" FOREIGN KEY ("callee_agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy today's parent -> sub-agent relations in one workspace as links (hand-written)
INSERT INTO "agent_links" ("caller_agent_id", "callee_agent_id")
SELECT "sub"."parent_agent_id", "sub"."id"
FROM "agents" AS "sub"
JOIN "agents" AS "parent" ON "parent"."id" = "sub"."parent_agent_id"
WHERE "parent"."workspace_id" = "sub"."workspace_id"
  AND "parent"."id" <> "sub"."id"
ON CONFLICT DO NOTHING;

-- DropForeignKey
ALTER TABLE "agents" DROP CONSTRAINT "agents_parent_agent_id_fkey";

-- DropIndex
DROP INDEX "agents_parent_agent_id_idx";

-- AlterTable
ALTER TABLE "agents" DROP COLUMN "agent_type",
DROP COLUMN "parent_agent_id";

COMMIT;
