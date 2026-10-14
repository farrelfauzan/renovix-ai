import { assertEmbeddingLength } from "./assert-embedding-length";

describe("assertEmbeddingLength (RX-160)", () => {
  it("accepts a vector of the column's length", () => {
    expect(() => assertEmbeddingLength(Array(1024).fill(0), 1024)).not.toThrow();
  });

  it.each([0, 768, 1536])("refuses %i dimensions, naming both lengths", (length) => {
    expect(() => assertEmbeddingLength(Array(length).fill(0), 1024)).toThrow(
      `Embedding has ${length} dimensions but knowledge_chunks.embedding is vector(1024)`,
    );
  });
});
