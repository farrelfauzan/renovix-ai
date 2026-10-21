import { BadRequestException } from "@nestjs/common";
import { KnowledgeService } from "./knowledge.service";
import type { EmbeddingService } from "./embedding.service";
import type { S3Service } from "./s3.service";
import type { KnowledgeBaseRepository } from "../repository/knowledge-base.repository";
import type { KnowledgeChunkRepository } from "../repository/knowledge-chunk.repository";

// RNX-173: the original file reaches S3 only after chunking and embedding succeed; a failed insert deletes it.
// No database: S3, embeddings and repositories are mocks.
describe("RNX-173: KnowledgeService.uploadMarkdown leaves no S3 object behind", () => {
  const inputKey = "knowledge/user-1/kb-1/123-notes.md";
  const mockKnowledgeBase = { id: "kb-1", userId: "user-1", workspaceId: null };
  const upload = jest.fn();
  const remove = jest.fn();
  const embed = jest.fn();
  const insertChunks = jest.fn();
  const service = new KnowledgeService(
    { embed } as unknown as EmbeddingService,
    { buildKey: () => inputKey, upload, delete: remove } as unknown as S3Service,
    { findKnowledgeBaseWithChunkCount: async () => mockKnowledgeBase } as unknown as KnowledgeBaseRepository,
    { insertChunks } as unknown as KnowledgeChunkRepository,
  );
  const validFile = { filename: "notes.md", buffer: Buffer.from("# Title\n\nSome body text for a chunk.") };

  beforeEach(() => {
    jest.resetAllMocks();
    embed.mockImplementation(async (texts: string[]) => texts.map(() => ({ embedding: [0.1], tokenCount: 3 })));
    insertChunks.mockImplementation(async (_id: string, rows: unknown[]) => rows);
  });

  it("AC1: a file with no chunks → 400 and no S3 upload", async () => {
    const emptyFile = { filename: "empty.md", buffer: Buffer.from("") };

    await expect(service.uploadMarkdown("user-1", "kb-1", emptyFile)).rejects.toBeInstanceOf(BadRequestException);

    expect(upload).not.toHaveBeenCalled();
  });

  it("AC2: the embedding service throws → that error and no S3 upload", async () => {
    const mockError = new Error("embedding down");
    embed.mockRejectedValue(mockError);

    await expect(service.uploadMarkdown("user-1", "kb-1", validFile)).rejects.toBe(mockError);

    expect(upload).not.toHaveBeenCalled();
  });

  it("AC3: the insert fails after the upload → the uploaded key is deleted and the insert error returned", async () => {
    const mockError = new Error("insert failed");
    insertChunks.mockRejectedValue(mockError);

    await expect(service.uploadMarkdown("user-1", "kb-1", validFile)).rejects.toBe(mockError);

    expect(remove).toHaveBeenCalledWith(inputKey);
  });

  it("AC3b: a failed delete is swallowed, the caller still gets the insert error", async () => {
    const mockError = new Error("insert failed");
    insertChunks.mockRejectedValue(mockError);
    remove.mockRejectedValue(new Error("s3 down"));

    await expect(service.uploadMarkdown("user-1", "kb-1", validFile)).rejects.toBe(mockError);
  });

  it("AC4: a valid file → one upload, every chunk carries the s3Key, nothing deleted", async () => {
    const actualResult = await service.uploadMarkdown("user-1", "kb-1", validFile);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(inputKey, validFile.buffer, "text/markdown");
    const insertedRows = insertChunks.mock.calls[0][1] as { metadata: { s3Key: string } }[];
    expect(insertedRows.length).toBeGreaterThan(0);
    expect(insertedRows.every((row) => row.metadata.s3Key === inputKey)).toBe(true);
    expect(actualResult.s3Key).toBe(inputKey);
    expect(remove).not.toHaveBeenCalled();
  });
});
