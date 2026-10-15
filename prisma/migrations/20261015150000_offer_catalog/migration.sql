-- RX-86: offer catalog, purchase snapshots, platform settings and their change records
-- (docs/credits.md section 9). Additive only: new types and tables, no existing row is touched.
-- The table SQL is from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`;
-- the CHECK constraint and the append-only triggers at the end are written by hand (Prisma does not model them).

-- CreateEnum
CREATE TYPE "PackageBilling" AS ENUM ('one_time', 'monthly');

-- CreateEnum
CREATE TYPE "CatalogEntity" AS ENUM ('package', 'package_version', 'top_up_pack', 'top_up_pack_version', 'enterprise_bundle', 'enterprise_bundle_version', 'company_contract', 'platform_setting');

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "visible" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_versions" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "price_rupiah" INTEGER NOT NULL,
    "credits_granted" DECIMAL(18,6) NOT NULL,
    "billing" "PackageBilling" NOT NULL,
    "max_agents" INTEGER NOT NULL,
    "max_connected_tools" INTEGER NOT NULL,
    "api_access" BOOLEAN NOT NULL,
    "allowed_channels" TEXT[],
    "allowed_tiers" TEXT[],
    "effective_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_up_packs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "top_up_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_up_pack_versions" (
    "id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "credits_granted" DECIMAL(18,6) NOT NULL,
    "price_rupiah" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top_up_pack_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_bundles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "enterprise_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_bundle_versions" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "pool_credits_per_period" DECIMAL(18,6),
    "monthly_price_rupiah" INTEGER,
    "effective_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_bundle_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_contracts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bundle_version_id" TEXT NOT NULL,
    "seat_limit" INTEGER NOT NULL,
    "default_member_share_credits" DECIMAL(18,6),
    "allowed_tiers" TEXT[],
    "grace_days" INTEGER,
    "whatsapp_enabled" BOOLEAN NOT NULL,
    "cap_policy" TEXT,
    "top_up_roles" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "company_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_snapshots" (
    "id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "package_version_id" TEXT,
    "top_up_pack_version_id" TEXT,
    "price_rupiah" INTEGER NOT NULL,
    "credits_granted" DECIMAL(18,6) NOT NULL,
    "billing" "PackageBilling",
    "max_agents" INTEGER,
    "max_connected_tools" INTEGER,
    "api_access" BOOLEAN,
    "allowed_channels" TEXT[],
    "allowed_tiers" TEXT[],
    "payment_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "name" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "catalog_changes" (
    "id" TEXT NOT NULL,
    "entity" "CatalogEntity" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "effective_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packages_name_key" ON "packages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "package_versions_package_id_version_number_key" ON "package_versions"("package_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "top_up_packs_name_key" ON "top_up_packs"("name");

-- CreateIndex
CREATE UNIQUE INDEX "top_up_pack_versions_pack_id_version_number_key" ON "top_up_pack_versions"("pack_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_bundles_name_key" ON "enterprise_bundles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_bundle_versions_bundle_id_version_number_key" ON "enterprise_bundle_versions"("bundle_id", "version_number");

-- CreateIndex
CREATE INDEX "company_contracts_company_id_idx" ON "company_contracts"("company_id");

-- CreateIndex
CREATE INDEX "company_contracts_bundle_version_id_idx" ON "company_contracts"("bundle_version_id");

-- CreateIndex
CREATE INDEX "purchase_snapshots_buyer_user_id_created_at_idx" ON "purchase_snapshots"("buyer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_snapshots_package_version_id_idx" ON "purchase_snapshots"("package_version_id");

-- CreateIndex
CREATE INDEX "purchase_snapshots_top_up_pack_version_id_idx" ON "purchase_snapshots"("top_up_pack_version_id");

-- CreateIndex
CREATE INDEX "catalog_changes_entity_entity_id_created_at_idx" ON "catalog_changes"("entity", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top_up_pack_versions" ADD CONSTRAINT "top_up_pack_versions_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "top_up_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_bundle_versions" ADD CONSTRAINT "enterprise_bundle_versions_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "enterprise_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_contracts" ADD CONSTRAINT "company_contracts_bundle_version_id_fkey" FOREIGN KEY ("bundle_version_id") REFERENCES "enterprise_bundle_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_snapshots" ADD CONSTRAINT "purchase_snapshots_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_snapshots" ADD CONSTRAINT "purchase_snapshots_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_snapshots" ADD CONSTRAINT "purchase_snapshots_top_up_pack_version_id_fkey" FOREIGN KEY ("top_up_pack_version_id") REFERENCES "top_up_pack_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: a purchase snapshot points at exactly one version (a package version or a top-up pack version).
ALTER TABLE "purchase_snapshots" ADD CONSTRAINT "purchase_snapshots_one_version_check"
    CHECK (num_nonnulls("package_version_id", "top_up_pack_version_id") = 1);

-- Hand-written: append-only tables. A statement-level trigger refuses every UPDATE and DELETE, so a version
-- that a purchase points at can never change (a change is a new version), and neither can a snapshot or a
-- change record. TRUNCATE is not refused: the test tooling empties the database with it (resetDatabase).
CREATE FUNCTION "refuse_update_delete_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is refused', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "package_versions_append_only" BEFORE UPDATE OR DELETE ON "package_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "refuse_update_delete_append_only"();

CREATE TRIGGER "top_up_pack_versions_append_only" BEFORE UPDATE OR DELETE ON "top_up_pack_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "refuse_update_delete_append_only"();

CREATE TRIGGER "enterprise_bundle_versions_append_only" BEFORE UPDATE OR DELETE ON "enterprise_bundle_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION "refuse_update_delete_append_only"();

CREATE TRIGGER "purchase_snapshots_append_only" BEFORE UPDATE OR DELETE ON "purchase_snapshots"
    FOR EACH STATEMENT EXECUTE FUNCTION "refuse_update_delete_append_only"();

CREATE TRIGGER "catalog_changes_append_only" BEFORE UPDATE OR DELETE ON "catalog_changes"
    FOR EACH STATEMENT EXECUTE FUNCTION "refuse_update_delete_append_only"();
