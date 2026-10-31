-- RNX-251 PR B: drop the legacy plan tables. PR A moved every reader to purchase snapshots (EntitlementService);
-- nothing reads or writes subscription_plans, user_subscriptions or invitation_codes.plan_id any more.
-- Destructive: the rows of both tables and every plan_id value are gone (nothing is deployed, D190).
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`
-- (foreign keys first, then the column, then the tables). invitation_codes.plan_id has no index of its own.
-- One explicit transaction (D247): `prisma migrate deploy` (Prisma 7) does not wrap a migration in one; with
-- BEGIN/COMMIT a failure anywhere leaves the database as it was before the migration.
-- Rollback (manual, structure only; the dropped rows do not come back):
-- BEGIN;
-- CREATE TABLE "subscription_plans" ("id" TEXT NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL,
--   "description" TEXT, "max_agents" INTEGER NOT NULL, "max_integrations" INTEGER NOT NULL,
--   "max_workspace_users" INTEGER NOT NULL, "max_tokens_per_month" BIGINT NOT NULL, "allowed_channels" TEXT[] NOT NULL,
--   "price_monthly" DECIMAL(10,2), "price_currency" TEXT NOT NULL DEFAULT 'USD', "is_active" BOOLEAN NOT NULL DEFAULT true,
--   "display_order" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   "updatedAt" TIMESTAMPTZ NOT NULL, CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id"));
-- CREATE UNIQUE INDEX "subscription_plans_slug_key" ON "subscription_plans"("slug");
-- CREATE TABLE "user_subscriptions" ("id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "plan_id" TEXT NOT NULL,
--   "status" TEXT NOT NULL DEFAULT 'active', "current_period_start" TIMESTAMPTZ NOT NULL,
--   "current_period_end" TIMESTAMPTZ NOT NULL, "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
--   "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ NOT NULL,
--   CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id"));
-- CREATE UNIQUE INDEX "user_subscriptions_user_id_key" ON "user_subscriptions"("user_id");
-- CREATE INDEX "user_subscriptions_user_id_status_idx" ON "user_subscriptions"("user_id", "status");
-- CREATE INDEX "user_subscriptions_plan_id_idx" ON "user_subscriptions"("plan_id");
-- ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- ALTER TABLE "invitation_codes" ADD COLUMN "plan_id" TEXT;
-- ALTER TABLE "invitation_codes" ADD CONSTRAINT "invitation_codes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- COMMIT;
BEGIN;

-- DropForeignKey
ALTER TABLE "user_subscriptions" DROP CONSTRAINT "user_subscriptions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_subscriptions" DROP CONSTRAINT "user_subscriptions_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "invitation_codes" DROP CONSTRAINT "invitation_codes_plan_id_fkey";

-- AlterTable
ALTER TABLE "invitation_codes" DROP COLUMN "plan_id";

-- DropTable
DROP TABLE "subscription_plans";

-- DropTable
DROP TABLE "user_subscriptions";

COMMIT;
