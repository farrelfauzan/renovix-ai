-- RX-21: per-token credit rates on AiModel (tier rates table + provider price columns).
-- tier, credit_multiplier and plan_required stay (plan_required's reads are retired; RX-177 drops the column).
-- No tier rate is inserted here: the adopted values come only from the seed (prisma/tier-rates.seed.json).

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN "cached_input_price" DECIMAL(18,12);
ALTER TABLE "ai_models" ADD COLUMN "price_updated_at" TIMESTAMPTZ;

-- AlterEnum
ALTER TYPE "CatalogEntity" ADD VALUE 'tier_rate';
ALTER TYPE "CatalogEntity" ADD VALUE 'ai_model';

-- CreateTable
CREATE TABLE "tier_rates" (
    "tier" TEXT NOT NULL,
    "input_credits_per_token" DECIMAL(18,12) NOT NULL,
    "cached_credits_per_token" DECIMAL(18,12) NOT NULL,
    "output_credits_per_token" DECIMAL(18,12) NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tier_rates_pkey" PRIMARY KEY ("tier")
);

-- CreateIndex
CREATE UNIQUE INDEX "tier_rates_tier_key" ON "tier_rates"("tier");
