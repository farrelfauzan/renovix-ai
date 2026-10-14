-- RX-96: back-office roles and permissions (PRD 09 F5, D56, D60 A4).
-- admin_users.role stays the role's name and becomes a foreign key to admin_roles(name).
-- The five built-in roles are seeded here so every environment has them.
-- Prisma has no down migrations: the down SQL is in the PR description.

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_pii_grants" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "subject_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by_admin_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_pii_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_name_key" ON "admin_roles"("name");

-- CreateIndex
CREATE INDEX "admin_pii_grants_admin_id_subject_user_id_expires_at_idx" ON "admin_pii_grants"("admin_id", "subject_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "admin_pii_grants_granted_by_admin_id_idx" ON "admin_pii_grants"("granted_by_admin_id");

-- CreateIndex
CREATE INDEX "admin_users_role_idx" ON "admin_users"("role");

-- Seed the built-in roles (PRD 09 F5). ON CONFLICT: the test factory runs this same statement again.
INSERT INTO "admin_roles" ("id", "name", "built_in", "permissions", "updated_at") VALUES
  (gen_random_uuid()::text, 'owner', true, ARRAY[
    'users:read', 'users:read_pii', 'users:write',
    'companies:read', 'companies:write',
    'enterprise_requests:read', 'enterprise_requests:write',
    'guardrails:read', 'guardrails:read_content', 'guardrails:write',
    'models:read', 'models:write',
    'providers:read', 'providers:write',
    'packages:read', 'packages:write',
    'credits:read', 'credits:adjust',
    'usage:read', 'exports:create', 'support_notes:write',
    'admins:read', 'admins:write',
    'roles:read', 'roles:write',
    'settings:read', 'settings:write'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'operations', true, ARRAY[
    'users:read', 'users:read_pii', 'users:write',
    'companies:read', 'companies:write',
    'enterprise_requests:read', 'enterprise_requests:write',
    'guardrails:read', 'guardrails:write',
    'models:read', 'models:write'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'finance', true, ARRAY[
    'packages:read', 'packages:write',
    'credits:read', 'credits:adjust',
    'usage:read', 'exports:create',
    'users:read', 'companies:read', 'enterprise_requests:read', 'guardrails:read',
    'models:read', 'providers:read', 'admins:read', 'roles:read', 'settings:read'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'support', true, ARRAY[
    'users:read', 'companies:read', 'support_notes:write'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'viewer', true, ARRAY[
    'users:read', 'companies:read', 'enterprise_requests:read', 'guardrails:read',
    'models:read', 'providers:read', 'packages:read', 'credits:read', 'usage:read',
    'admins:read', 'roles:read', 'settings:read'
  ]::text[], CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Backfill (RX-94 wrote "owner" | "admin"; no production data, D49): "admin" becomes Operations.
UPDATE "admin_users" SET "role" = 'operations' WHERE "role" = 'admin';

-- AddForeignKey (fails on any other role value: nothing is guessed)
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_fkey" FOREIGN KEY ("role") REFERENCES "admin_roles"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_pii_grants" ADD CONSTRAINT "admin_pii_grants_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_pii_grants" ADD CONSTRAINT "admin_pii_grants_granted_by_admin_id_fkey" FOREIGN KEY ("granted_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
