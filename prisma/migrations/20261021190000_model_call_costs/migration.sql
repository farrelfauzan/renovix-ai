-- RNX-162 (D243 decision 38, D235): per-call model cost capture. Additive only: four nullable columns on providers
-- (null means off: multiplier 1, no floor, no high case) and the new table model_call_costs, one row per call_id, 1:1
-- with the call's usage entry in credit_ledger_entries (which is not changed). No data is rewritten.
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`,
-- wrapped in one transaction (D247).

BEGIN;

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "cost_multiplier" DECIMAL(12,6),
ADD COLUMN     "high_case_factor" DECIMAL(12,6),
ADD COLUMN     "high_case_token_threshold" INTEGER,
ADD COLUMN     "per_call_floor_usd" DECIMAL(18,12);

-- CreateTable
CREATE TABLE "model_call_costs" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "provider_id" TEXT,
    "provider_model_id" TEXT NOT NULL,
    "tokens_new" INTEGER NOT NULL,
    "tokens_cached" INTEGER NOT NULL,
    "tokens_out" INTEGER NOT NULL,
    "tokens_reasoning" INTEGER,
    "reported_cost_usd" DECIMAL(18,12),
    "token_price_usd" DECIMAL(18,12),
    "cost_low_usd" DECIMAL(18,12),
    "cost_high_usd" DECIMAL(18,12),
    "cost_low_idr" DECIMAL(24,12),
    "cost_high_idr" DECIMAL(24,12),
    "exchange_rate" DECIMAL(18,6),
    "exchange_rate_date" DATE,
    "wallet" "CreditWallet" NOT NULL,
    "workspace_id" TEXT,
    "tier" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_call_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_call_costs_call_id_key" ON "model_call_costs"("call_id");

-- CreateIndex
CREATE INDEX "model_call_costs_created_at_idx" ON "model_call_costs"("created_at");

COMMIT;
