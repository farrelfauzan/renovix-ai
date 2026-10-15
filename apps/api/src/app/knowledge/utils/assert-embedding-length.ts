/**
 * Refuses a vector that does not fit knowledge_chunks.embedding (RX-160). Callers insert the vectors
 * only after embed() returns, so throwing here means nothing is written.
 */
export function assertEmbeddingLength(embedding: number[], columnDimensions: number): void {
  if (embedding.length === columnDimensions) return;
  throw new Error(
    `Embedding has ${embedding.length} dimensions but knowledge_chunks.embedding is vector(${columnDimensions}); check EMBEDDING_MODEL and EMBEDDING_DIMENSIONS`,
  );
}
