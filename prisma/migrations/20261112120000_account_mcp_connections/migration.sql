-- RNX-292 (D312): an MCP credential belongs to the account (one per user and provider), switched on per workspace by
-- a row of workspace_mcp_connections (deleted with its workspace or its credential). mcp_oauth_states keeps a nullable
-- workspace_id: the workspace to switch the connection on in after the callback, if the flow was started from one.
-- Changes data: nothing is deployed (D190), so user_mcp_credentials and mcp_oauth_states are emptied before the
-- constraint change; no credential or started flow is carried over (each user connects again).
-- The schema SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.
-- The unique (user_id, provider) also serves the lookups by user; the (credential_id) index serves the cascade from a
-- credential and the list of its workspaces; the unique (workspace_id, credential_id) serves the lookups and deletes
-- by workspace.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual; the emptied rows do not come back, each user connects again):
-- BEGIN;
-- DROP TABLE "workspace_mcp_connections";
-- DELETE FROM "user_mcp_credentials";
-- DELETE FROM "mcp_oauth_states";
-- ALTER TABLE "mcp_oauth_states" ALTER COLUMN "workspace_id" SET NOT NULL;
-- DROP INDEX "user_mcp_credentials_user_id_provider_key";
-- ALTER TABLE "user_mcp_credentials" ADD COLUMN "workspace_id" TEXT NOT NULL;
-- CREATE UNIQUE INDEX "user_mcp_credentials_user_id_workspace_id_provider_key" ON "user_mcp_credentials"("user_id", "workspace_id", "provider");
-- CREATE INDEX "user_mcp_credentials_user_id_workspace_id_idx" ON "user_mcp_credentials"("user_id", "workspace_id");
-- CREATE INDEX "user_mcp_credentials_workspace_id_provider_idx" ON "user_mcp_credentials"("workspace_id", "provider");
-- ALTER TABLE "user_mcp_credentials" ADD CONSTRAINT "user_mcp_credentials_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- COMMIT;
BEGIN;

-- Data: nothing is carried over (D190)
DELETE FROM "mcp_oauth_states";
DELETE FROM "user_mcp_credentials";

-- DropForeignKey
ALTER TABLE "user_mcp_credentials" DROP CONSTRAINT "user_mcp_credentials_workspace_id_fkey";

-- DropIndex
DROP INDEX "user_mcp_credentials_user_id_workspace_id_idx";

-- DropIndex
DROP INDEX "user_mcp_credentials_workspace_id_provider_idx";

-- DropIndex
DROP INDEX "user_mcp_credentials_user_id_workspace_id_provider_key";

-- AlterTable
ALTER TABLE "user_mcp_credentials" DROP COLUMN "workspace_id";

-- AlterTable
ALTER TABLE "mcp_oauth_states" ALTER COLUMN "workspace_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "workspace_mcp_connections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "enabled_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_mcp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_mcp_connections_credential_id_idx" ON "workspace_mcp_connections"("credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_mcp_connections_workspace_id_credential_id_key" ON "workspace_mcp_connections"("workspace_id", "credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_mcp_credentials_user_id_provider_key" ON "user_mcp_credentials"("user_id", "provider");

-- AddForeignKey
ALTER TABLE "workspace_mcp_connections" ADD CONSTRAINT "workspace_mcp_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_mcp_connections" ADD CONSTRAINT "workspace_mcp_connections_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "user_mcp_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
