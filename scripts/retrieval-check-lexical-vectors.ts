// RNX-27: writes the vectors of the retrieval check set (apps/api/src/app/knowledge/fixtures/retrieval-check-set.json)
// with a deterministic LEXICAL stand-in, under the model name "fixture-lexical": every word (lower case, letters and
// digits) is hashed into one of 1024 dimensions with a sign, counted, and the vector is normalised to length 1. It is
// NOT an embedding model: it only matches shared words. It is used until real vectors are recorded with
// scripts/retrieval-check-record-vectors.ts. No network, no key.
//   bun scripts/retrieval-check-lexical-vectors.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dir, "../apps/api/src/app/knowledge/fixtures");
const SET_FILE = resolve(FIXTURES, "retrieval-check-set.json");
const VECTORS_FILE = resolve(FIXTURES, "retrieval-check-vectors.json");
const MODEL = "fixture-lexical";
const DIMENSIONS = 1024;
const DECIMALS = 6;

type CheckSet = { chunks: { content: string }[]; questions: { question: string }[] };

/** The hashed bag of words of `text`, normalised to length 1. */
function embedLexically(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const digest = createHash("sha256").update(word).digest();
    vector[digest.readUInt32BE(0) % DIMENSIONS] += digest[4] & 1 ? 1 : -1;
  }
  const length = Math.hypot(...vector);
  return vector.map((value) => Number((value / length).toFixed(DECIMALS)));
}

const set: CheckSet = JSON.parse(readFileSync(SET_FILE, "utf-8"));
const texts = [...set.chunks.map((chunk) => chunk.content), ...set.questions.map((question) => question.question)];
const vectors = Object.fromEntries(texts.map((text) => [text, embedLexically(text)]));
const fixture = {
  model: MODEL,
  dimensions: DIMENSIONS,
  note: "Lexical stand-in (hashed bag of words), NOT text-embedding-3-large. Written by scripts/retrieval-check-lexical-vectors.ts; replace with scripts/retrieval-check-record-vectors.ts.",
  vectors,
};
writeFileSync(VECTORS_FILE, `${JSON.stringify(fixture)}\n`);
console.log(`Wrote ${texts.length} ${MODEL} vectors to ${VECTORS_FILE}`);
