-- RNX-179 (D58, D149): each model may have an ordered list of fallback models. A call that gets a 502 or 503 goes to
-- the next fallback, each with its own provider and slug. Position is 0-based; a model names each fallback once, and
-- never itself (the CHECK; the admin route also refuses it with 400). Deleting either model removes the row (models
-- are deactivated, not deleted, so this only matters to a hand-run delete).
-- The SQL is from `prisma migrate diff --from-schema <schema at main> --to-schema prisma/schema.prisma --script`,
-- plus the CHECK, which Prisma does not model (and so does not compare).

-- CreateTable
CREATE TABLE "ai_model_fallbacks" (
    "model_id" TEXT NOT NULL,
    "fallback_model_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ai_model_fallbacks_pkey" PRIMARY KEY ("model_id","position"),
    CONSTRAINT "ai_model_fallbacks_not_self" CHECK ("model_id" <> "fallback_model_id")
);

-- CreateIndex
CREATE INDEX "ai_model_fallbacks_fallback_model_id_idx" ON "ai_model_fallbacks"("fallback_model_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_fallbacks_model_id_fallback_model_id_key" ON "ai_model_fallbacks"("model_id", "fallback_model_id");

-- AddForeignKey
ALTER TABLE "ai_model_fallbacks" ADD CONSTRAINT "ai_model_fallbacks_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_fallbacks" ADD CONSTRAINT "ai_model_fallbacks_fallback_model_id_fkey" FOREIGN KEY ("fallback_model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
