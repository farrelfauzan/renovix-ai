-- RX-164: the staff permission `audit:read` (D138) and the indexes of the audit log screen. Additive only:
-- no table or column changes, no row is deleted; no backup is needed.

-- Grant `audit:read` to the built-in roles Owner, Operations, Finance and Viewer, NOT Support (D138).
-- Permissions are the `permissions` text array of each role (RX-96), so adding one is an UPDATE keyed by
-- the role's name (never by id); a role that already holds it is left as it is. Custom roles are not touched.
-- The test helper seedAdminRoles runs this same statement after the baseline INSERT.
UPDATE "admin_roles"
SET "permissions" = array_append(COALESCE("permissions", ARRAY[]::text[]), 'audit:read'), "updated_at" = CURRENT_TIMESTAMP
WHERE "built_in" = true
  AND "name" IN ('owner', 'operations', 'finance', 'viewer')
  AND NOT ('audit:read' = ANY(COALESCE("permissions", ARRAY[]::text[])));

-- The read route and the CSV export page by a keyset over (created_at DESC, id DESC), newest first.
-- The existing (admin_id, created_at) and (resource, created_at) indexes serve those two filters; this
-- one serves the unfiltered list and the date range, the next one the action filter.
-- Generated with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_id_idx" ON "admin_audit_log"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_log_action_created_at_idx" ON "admin_audit_log"("action", "created_at");
