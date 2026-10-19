-- RX-177 (D148, D149): provider records and their models, filled only through /admin/providers; no row is inserted here.
-- Drops ai_models.plan_required (D185 item 3a): its reads were retired by RX-21; no data migration (D149).
-- RX-177: new models do not write provider_id (D149 option B, the slug is the provider's id); request-time resolution is RX-178.
-- providers.name is unique among live rows only: a partial unique index (Prisma's partialIndexes preview feature).

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('9router', 'openai_compatible');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('inactive', 'active');

-- AlterTable
ALTER TABLE "ai_models" DROP COLUMN "plan_required",
ADD COLUMN     "provider_record_id" TEXT,
ALTER COLUMN "provider_id" SET DEFAULT '';

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "type" "ProviderType" NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_ciphertext" TEXT NOT NULL,
    "api_key_hint" TEXT NOT NULL,
    "credential_key_version" INTEGER NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'inactive',
    "last_tested_at" TIMESTAMPTZ,
    "last_test_result" TEXT,
    "created_by_admin_id" TEXT NOT NULL,
    "updated_by_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "providers_created_by_admin_id_idx" ON "providers"("created_by_admin_id");

-- CreateIndex
CREATE INDEX "providers_updated_by_admin_id_idx" ON "providers"("updated_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "providers_name_key" ON "providers"("name") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "ai_models_provider_record_id_idx" ON "ai_models"("provider_record_id");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_record_id_fkey" FOREIGN KEY ("provider_record_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
