/** A row of a similarity search on `knowledge_chunks` in a user's bases, as the raw SQL returns it (RX-137). */
export type ChunkSearchRow = {
  id: string;
  content: string;
  metadata: unknown;
  token_count: number;
  knowledge_base_id: string;
  similarity: number;
};
