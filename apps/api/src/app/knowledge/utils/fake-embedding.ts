import { createHash } from "crypto";
import { EMBEDDING_COLUMN_DIMENSIONS } from "../config/embedding-column-dimensions";
import type { EmbeddingResult } from "../service/embedding.service";

/** Same text, same vector; values in [-1, 1] from SHA-256 of the text. */
export function fakeEmbedding(text: string): EmbeddingResult {
  const embedding: number[] = [];
  for (let block = 0; embedding.length < EMBEDDING_COLUMN_DIMENSIONS; block++) {
    const digest = createHash("sha256").update(`${block}:${text}`).digest();
    for (const byte of digest) embedding.push(byte / 127.5 - 1);
  }
  return {
    embedding: embedding.slice(0, EMBEDDING_COLUMN_DIMENSIONS),
    tokenCount: Math.ceil(text.length / 4),
  };
}
