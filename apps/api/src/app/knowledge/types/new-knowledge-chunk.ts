/** One chunk to store in `knowledge_chunks`: its text, metadata, embedding and token count (RX-137). */
export type NewKnowledgeChunk = {
  readonly content: string;
  readonly metadata: unknown;
  readonly embedding: readonly number[];
  readonly tokenCount: number;
};
