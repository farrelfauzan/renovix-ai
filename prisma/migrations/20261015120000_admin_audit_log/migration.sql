-- RX-97: the back-office audit log (D57, D61, D137, D138). Additive only: one new table, its indexes,
-- its foreign key and its append-only trigger; no existing row is touched. The table, indexes and
-- foreign key were generated with
--   prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- against a database with every earlier migration applied; the trigger is hand-written (Prisma does
-- not model triggers, so `migrate diff` ignores it).

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_admin_id_created_at_idx" ON "admin_audit_log"("admin_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_resource_created_at_idx" ON "admin_audit_log"("resource", "created_at");

-- AddForeignKey
-- RESTRICT: an admin who has audit rows cannot be deleted (or have their id changed), so deleting an
-- admin can never rewrite or orphan audit rows. Erasure on request is RX-146.
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Append-only, enforced by the database (D57): every UPDATE or DELETE statement on the table fails,
-- from the application and from direct SQL alike, before any row is changed. Statement-level, so it
-- fires even when the statement matches no row. TRUNCATE is not blocked (it is not an UPDATE or DELETE;
-- the test database reset uses it). Retention: at least two years; nothing deletes rows, no purge job.
CREATE FUNCTION "admin_audit_log_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER "admin_audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "admin_audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "admin_audit_log_refuse_change"();
