import { BadRequestException } from "@nestjs/common";
import { WorkspaceKnowledgeService } from "./workspace-knowledge.service";
import type { PrismaService } from "../../prisma/prisma.service";
import type { EmbeddingService } from "../../knowledge/service/embedding.service";
import type { S3Service } from "../../knowledge/service/s3.service";
import type { KnowledgeChunkRepository } from "../../knowledge/repository/knowledge-chunk.repository";
import type { WorkspaceMemberRepository } from "../repository/workspace-member.repository";
import type { WorkspaceQuotaService } from "./workspace-quota.service";

// RNX-173: the workspace upload path stores the file in S3 only after chunking and embedding succeed; a failed
// insert deletes it. No database: S3, embeddings and Prisma are mocks.
describe("RNX-173: WorkspaceKnowledgeService.uploadMarkdown leaves no S3 object behind", () => {
  const inputKey = "knowledge/workspace-ws-1/kb-1/123-notes.md";
  const upload = jest.fn();
  const remove = jest.fn();
  const embed = jest.fn();
  const transaction = jest.fn();
  const executeRaw = jest.fn();
  const prisma = {
    knowledgeBase: { findUnique: async () => ({ id: "kb-1", workspaceId: "ws-1" }) },
    $transaction: transaction,
    $executeRaw: executeRaw,
  };
  const service = new WorkspaceKnowledgeService(
    prisma as unknown as PrismaService,
    { embed } as unknown as EmbeddingService,
    { buildKey: () => inputKey, upload, delete: remove } as unknown as S3Service,
    {} as KnowledgeChunkRepository,
    {} as WorkspaceMemberRepository,
    {} as WorkspaceQuotaService,
  );
  const validFile = { filename: "notes.md", buffer: Buffer.from("# Title\n\nSome body text for a chunk.") };

  beforeEach(() => {
    jest.resetAllMocks();
    embed.mockImplementation(async (texts: string[]) => texts.map(() => ({ embedding: [0.1], tokenCount: 3 })));
    executeRaw.mockImplementation((sql: unknown) => sql);
    transaction.mockImplementation(async (operations: unknown[]) => operations);
  });

  it("AC1: a file with no chunks → 400 and no S3 upload", async () => {
    const emptyFile = { filename: "empty.md", buffer: Buffer.from("") };

    await expect(service.uploadMarkdown("ws-1", "kb-1", "user-1", emptyFile)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(upload).not.toHaveBeenCalled();
  });

  it("AC2: the embedding service throws → that error and no S3 upload", async () => {
    const mockError = new Error("embedding down");
    embed.mockRejectedValue(mockError);

    await expect(service.uploadMarkdown("ws-1", "kb-1", "user-1", validFile)).rejects.toBe(mockError);

    expect(upload).not.toHaveBeenCalled();
  });

  it("AC3: the insert fails after the upload → the uploaded key is deleted and the insert error returned", async () => {
    const mockError = new Error("insert failed");
    transaction.mockRejectedValue(mockError);

    await expect(service.uploadMarkdown("ws-1", "kb-1", "user-1", validFile)).rejects.toBe(mockError);

    expect(remove).toHaveBeenCalledWith(inputKey);
  });

  it("AC3b: a failed delete is swallowed, the caller still gets the insert error", async () => {
    const mockError = new Error("insert failed");
    transaction.mockRejectedValue(mockError);
    remove.mockRejectedValue(new Error("s3 down"));

    await expect(service.uploadMarkdown("ws-1", "kb-1", "user-1", validFile)).rejects.toBe(mockError);
  });

  it("AC4: a valid file → one upload, every inserted chunk's metadata holds the s3Key, nothing deleted", async () => {
    const actualResult = await service.uploadMarkdown("ws-1", "kb-1", "user-1", validFile);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(inputKey, validFile.buffer, "text/markdown");
    expect(executeRaw.mock.calls.length).toBeGreaterThan(0);
    const actualSqlValues = executeRaw.mock.calls.map((call) => (call[0] as { values: unknown[] }).values);
    expect(
      actualSqlValues.every((values) => values.some((value) => typeof value === "string" && value.includes(`"s3Key":"${inputKey}"`))),
    ).toBe(true);
    expect(actualResult.chunksInserted).toBe(executeRaw.mock.calls.length);
    expect(remove).not.toHaveBeenCalled();
  });
});
