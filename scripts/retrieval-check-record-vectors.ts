// RNX-27: records REAL vectors for the retrieval check set (apps/api/src/app/knowledge/fixtures/retrieval-check-set.json)
// from the configured embedding endpoint and writes them to retrieval-check-vectors.json under the endpoint's model name,
// replacing the lexical stand-in. It sends one real, billed embeddings request (every chunk and question in one batch)
// through EmbeddingService, so the request is the one the API sends (model, dimensions) and a wrong-length answer is
// refused the same way. Reads EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL and EMBEDDING_DIMENSIONS from the
// environment (Bun also loads .env). Refuses LLM_PROVIDER=fake. Prints counts and the model name only, never the key.
// Run by hand from the repo root, never in CI:
//   bun scripts/retrieval-check-record-vectors.ts
import "reflect-metadata";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { EmbeddingService } from "../apps/api/src/app/knowledge/service/embedding.service";
import { EMBEDDING_COLUMN_DIMENSIONS } from "../apps/api/src/app/knowledge/config/embedding-column-dimensions";
import { FAKE_EMBEDDING_MODEL } from "../apps/api/src/app/knowledge/config/fake-embedding-model";

const FIXTURES = resolve(import.meta.dir, "../apps/api/src/app/knowledge/fixtures");
const SET_FILE = resolve(FIXTURES, "retrieval-check-set.json");
const VECTORS_FILE = resolve(FIXTURES, "retrieval-check-vectors.json");

type CheckSet = { chunks: { content: string }[]; questions: { question: string }[] };

const service = new EmbeddingService(new ConfigService(process.env));
if (service.modelName === FAKE_EMBEDDING_MODEL) {
  console.error("LLM_PROVIDER=fake: nothing to record. Unset it and set EMBEDDING_* to the real endpoint.");
  process.exit(1);
}
const set: CheckSet = JSON.parse(readFileSync(SET_FILE, "utf-8"));
const texts = [...set.chunks.map((chunk) => chunk.content), ...set.questions.map((question) => question.question)];
const results = await service.embed(texts);
const fixture = {
  model: service.modelName,
  dimensions: EMBEDDING_COLUMN_DIMENSIONS,
  note: `Recorded from the configured endpoint on ${new Date().toISOString()} by scripts/retrieval-check-record-vectors.ts.`,
  vectors: Object.fromEntries(texts.map((text, i) => [text, results[i].embedding])),
};
writeFileSync(VECTORS_FILE, `${JSON.stringify(fixture)}\n`);
console.log(`Wrote ${texts.length} ${service.modelName} vectors (${EMBEDDING_COLUMN_DIMENSIONS} dimensions) to ${VECTORS_FILE}`);
