-- RX-151: one-time values of the MCP OAuth flows (signed state, single use, expiry).
-- Additive only: one new table, its index and two foreign keys; no existing table changes.
-- Rollback: DROP TABLE "mcp_oauth_states";

-- CreateTable
CREATE TABLE "mcp_oauth_states" (
    "nonce" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_states_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "mcp_oauth_states_expires_at_idx" ON "mcp_oauth_states"("expires_at");

-- AddForeignKey
ALTER TABLE "mcp_oauth_states" ADD CONSTRAINT "mcp_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_oauth_states" ADD CONSTRAINT "mcp_oauth_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
