-- RNX-53 (D235): catalog prices in US dollar cents, a daily USD to IDR rate, and the rate stored on each purchase.
-- The rupiah price is the USD price x the latest stored rate; there is no hand-set rupiah table any more.
-- Nothing is deployed (D190): the rupiah price columns of the versions are replaced, not migrated, and the new
-- NOT NULL columns have no default. On a database whose offer tables hold rows this migration fails on purpose.
-- The append-only triggers of 20261015150000_offer_catalog are statement-level BEFORE UPDATE OR DELETE triggers
-- and name no column, and the one-version CHECK names only the version ids, so neither needs a change.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`.

-- AlterTable
ALTER TABLE "package_versions" DROP COLUMN "price_rupiah",
ADD COLUMN     "price_usd_cents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "top_up_pack_versions" DROP COLUMN "price_rupiah",
ADD COLUMN     "price_usd_cents" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "enterprise_bundle_versions" DROP COLUMN "monthly_price_rupiah",
ADD COLUMN     "monthly_price_usd_cents" INTEGER;

-- AlterTable
ALTER TABLE "purchase_snapshots" ADD COLUMN     "exchange_rate" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "exchange_rate_date" DATE NOT NULL,
ADD COLUMN     "exchange_rate_source" TEXT NOT NULL,
ADD COLUMN     "price_usd_cents" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "rate_date" DATE NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_quote_rate_date_source_key" ON "exchange_rates"("base", "quote", "rate_date", "source");
