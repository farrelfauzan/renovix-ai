BEGIN;

-- RNX-27: every chunk records the embedding model that made its vector and when; a search compares only vectors of
-- the current model, so the index leads with the base and then the model.
-- Rows that exist before this migration get embedding_model 'unknown' and embedded_at the migration time (the
-- defaults are dropped at once, so every later write must give both). No search model is named 'unknown', so those
-- rows are never returned; they are not re-embedded (D49) and nothing is deleted.
-- Rollback (manual, only if needed):
-- BEGIN; DROP INDEX "knowledge_chunks_knowledgeBaseId_embedding_model_idx";
-- CREATE INDEX "knowledge_chunks_knowledgeBaseId_idx" ON "knowledge_chunks"("knowledgeBaseId");
-- ALTER TABLE "knowledge_chunks" DROP COLUMN "embedded_at", DROP COLUMN "embedding_model"; COMMIT;
-- The application intentionally has no automatic destructive down migration.

ALTER TABLE "knowledge_chunks"
  ADD COLUMN "embedding_model" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "embedded_at" TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE "knowledge_chunks"
  ALTER COLUMN "embedding_model" DROP DEFAULT,
  ALTER COLUMN "embedded_at" DROP DEFAULT;

DROP INDEX "knowledge_chunks_knowledgeBaseId_idx";

CREATE INDEX "knowledge_chunks_knowledgeBaseId_embedding_model_idx" ON "knowledge_chunks"("knowledgeBaseId", "embedding_model");

COMMIT;
