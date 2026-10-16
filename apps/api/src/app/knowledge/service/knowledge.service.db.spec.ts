import { BadRequestException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { KnowledgeService } from "./knowledge.service";
import { EmbeddingService } from "./embedding.service";
import { S3Service } from "./s3.service";
import { chunkMarkdown } from "../utils/markdown-chunker";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createWorkspace } from "../../../../test/factories";

// RX-137: search results and chunk storage of KnowledgeService on the test database, written before the
// knowledge module's queries moved into repositories, so the move can be shown to change nothing.
// Embeddings never call a provider: the stub returns fixed vectors. A document vector [a, sqrt(1 - a^2), 0, ...]
// against the query vector [1, 0, ...] has cosine similarity a, so the expected order and scores are known.
jest.mock("./embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("./s3.service", () => ({ S3Service: class {} }));

const DIMENSIONS = 1024;
const QUERY = "fixed query";

/** A 1024-dimension unit vector with cosine similarity `similarity` to the query vector. */
const unitVector = (similarity: number) => {
  const vector = new Array(DIMENSIONS).fill(0);
  vector[0] = similarity;
  vector[1] = Math.sqrt(1 - similarity * similarity);
  return vector;
};

/** A vector whose values are exact in float4, so it reads back unchanged. */
const exactVector = (first: number, second: number) => {
  const vector = new Array(DIMENSIONS).fill(0);
  vector[0] = first;
  vector[1] = second;
  return vector;
};

describe("KnowledgeService: search results and chunk storage (RX-137, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: KnowledgeService;
  const vectors = new Map<string, number[]>();
  const embedding = {
    embed: jest.fn(async (texts: string[]) =>
      texts.map((text, i) => ({ embedding: vectors.get(text) ?? exactVector(0.5, 0.25), tokenCount: 10 + i })),
    ),
    embedSingle: jest.fn(async (text: string) => ({ embedding: vectors.get(text) ?? unitVector(1), tokenCount: 2 })),
  };
  const s3 = {
    buildKey: jest.fn((userId: string, kbId: string, filename: string) => `knowledge/${userId}/${kbId}/fixed-${filename}`),
    upload: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        KnowledgeService,
        { provide: EmbeddingService, useValue: embedding },
        { provide: S3Service, useValue: s3 },
      ],
    }));
    service = moduleRef.get(KnowledgeService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    vectors.clear();
    vectors.set(QUERY, unitVector(1));
    jest.clearAllMocks();
  });

  afterAll(() => moduleRef?.close());

  /** Stores a chunk with a fixed id and vector directly, independent of the code under test. */
  const seedChunk = async (input: {
    id: string;
    knowledgeBaseId: string;
    similarity: number | null;
    tokenCount?: number;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
  }) => {
    const vector = input.similarity === null ? null : `[${unitVector(input.similarity).join(",")}]`;
    await prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt")
      VALUES (${input.id}, ${input.knowledgeBaseId}, ${`content of ${input.id}`},
        ${JSON.stringify(input.metadata ?? { tag: input.id })}::jsonb, ${vector}::vector, ${input.tokenCount ?? 5},
        ${input.createdAt ?? new Date()})`;
  };

  /** Every stored chunk with its embedding as text, ordered by content. */
  const readStoredChunks = () =>
    prisma.$queryRaw<
      {
        id: string;
        knowledgeBaseId: string;
        content: string;
        metadata: unknown;
        embedding: string | null;
        tokenCount: number;
        createdAt: Date;
      }[]
    >`SELECT id, "knowledgeBaseId", content, metadata, embedding::text AS embedding, "tokenCount", "createdAt"
      FROM "knowledge_chunks" ORDER BY content`;

  const expectedResult = (id: string, knowledgeBaseId: string, similarity: number, tokenCount = 5) => ({
    id,
    content: `content of ${id}`,
    metadata: { tag: id },
    tokenCount,
    knowledgeBaseId,
    similarity: expect.closeTo(similarity, 5),
  });

  /**
   * Alice: two active personal bases, one inactive personal base, one workspace base. Bob: one base.
   * Chunk names carry their similarity to the query (s90 = 0.9).
   */
  const seedSearchFixture = async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const workspace = await createWorkspace(prisma, { ownerId: alice.id });
    const kbA = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "A" } });
    const kbB = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "B" } });
    const kbInactive = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "off", active: false } });
    const kbWorkspace = await prisma.knowledgeBase.create({
      data: { userId: alice.id, workspaceId: workspace.id, name: "team" },
    });
    const kbBob = await prisma.knowledgeBase.create({ data: { userId: bob.id, name: "bob" } });
    await seedChunk({ id: "a-s30", knowledgeBaseId: kbA.id, similarity: 0.3 });
    await seedChunk({ id: "a-s90", knowledgeBaseId: kbA.id, similarity: 0.9, tokenCount: 9 });
    await seedChunk({ id: "a-s50", knowledgeBaseId: kbA.id, similarity: 0.5 });
    await seedChunk({ id: "a-neg20", knowledgeBaseId: kbA.id, similarity: -0.2 });
    await seedChunk({ id: "a-none", knowledgeBaseId: kbA.id, similarity: null });
    await seedChunk({ id: "a-s70", knowledgeBaseId: kbA.id, similarity: 0.7 });
    await seedChunk({ id: "a-s10", knowledgeBaseId: kbA.id, similarity: 0.1 });
    await seedChunk({ id: "b-s80", knowledgeBaseId: kbB.id, similarity: 0.8 });
    await seedChunk({ id: "b-s40", knowledgeBaseId: kbB.id, similarity: 0.4 });
    await seedChunk({ id: "off-s99", knowledgeBaseId: kbInactive.id, similarity: 0.99 });
    await seedChunk({ id: "team-s98", knowledgeBaseId: kbWorkspace.id, similarity: 0.98 });
    await seedChunk({ id: "bob-s97", knowledgeBaseId: kbBob.id, similarity: 0.97 });
    return { alice, bob, kbA, kbB, kbInactive };
  };

  describe("searchChunks", () => {
    it("in one base: the topK closest chunks with a vector, closest first, with their scores", async () => {
      const { alice, kbA } = await seedSearchFixture();

      const actual = await service.searchChunks(alice.id, QUERY, { knowledgeBaseId: kbA.id, topK: 3 });

      expect(actual).toEqual([
        expectedResult("a-s90", kbA.id, 0.9, 9),
        expectedResult("a-s70", kbA.id, 0.7),
        expectedResult("a-s50", kbA.id, 0.5),
      ]);
      expect(embedding.embedSingle).toHaveBeenCalledWith(QUERY);
    });

    it("in one base without topK: 5 results; a chunk without a vector is never returned", async () => {
      const { alice, kbA } = await seedSearchFixture();

      const actual = await service.searchChunks(alice.id, QUERY, { knowledgeBaseId: kbA.id });

      expect(actual).toEqual([
        expectedResult("a-s90", kbA.id, 0.9, 9),
        expectedResult("a-s70", kbA.id, 0.7),
        expectedResult("a-s50", kbA.id, 0.5),
        expectedResult("a-s30", kbA.id, 0.3),
        expectedResult("a-s10", kbA.id, 0.1),
      ]);
    });

    it("in one base with topK above the number of chunks: every chunk with a vector, the negative score last", async () => {
      const { alice, kbA } = await seedSearchFixture();

      const actual = await service.searchChunks(alice.id, QUERY, { knowledgeBaseId: kbA.id, topK: 50 });

      expect(actual.map((r) => r.id)).toEqual(["a-s90", "a-s70", "a-s50", "a-s30", "a-s10", "a-neg20"]);
      expect(actual[5].similarity).toBeCloseTo(-0.2, 5);
    });

    it("in an inactive base of the user, by id: still searched (only the all-bases search skips inactive ones)", async () => {
      const { alice, kbInactive } = await seedSearchFixture();

      const actual = await service.searchChunks(alice.id, QUERY, { knowledgeBaseId: kbInactive.id });

      expect(actual).toEqual([expectedResult("off-s99", kbInactive.id, 0.99)]);
    });

    it("across the user's bases: only active personal bases of this user, closest first, default topK 5", async () => {
      const { alice, kbA, kbB } = await seedSearchFixture();

      const actual = await service.searchChunks(alice.id, QUERY);

      expect(actual).toEqual([
        expectedResult("a-s90", kbA.id, 0.9, 9),
        expectedResult("b-s80", kbB.id, 0.8),
        expectedResult("a-s70", kbA.id, 0.7),
        expectedResult("a-s50", kbA.id, 0.5),
        expectedResult("b-s40", kbB.id, 0.4),
      ]);
    });

    it("across the user's bases with topK 2", async () => {
      const { alice, kbA, kbB } = await seedSearchFixture();

      const actual = await service.searchChunks(alice.id, QUERY, { topK: 2 });

      expect(actual).toEqual([expectedResult("a-s90", kbA.id, 0.9, 9), expectedResult("b-s80", kbB.id, 0.8)]);
    });

    it("across the bases of another user: only that user's chunks", async () => {
      const { bob } = await seedSearchFixture();

      const actual = await service.searchChunks(bob.id, QUERY);

      expect(actual.map((r) => r.id)).toEqual(["bob-s97"]);
    });
  });

  describe("chunk storage", () => {
    it("addChunks stores each chunk with its content, metadata ({} when none), vector and token count", async () => {
      const alice = await createUser(prisma);
      const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "A" } });
      vectors.set("first", exactVector(0.5, 0.25));
      vectors.set("second", exactVector(-0.75, 0.125));

      const actual = await service.addChunks(alice.id, kb.id, [
        { content: "first", metadata: { source: "manual", page: 2 } },
        { content: "second" },
      ]);

      expect(actual).toEqual({ inserted: 2 });
      const stored = await readStoredChunks();
      expect(stored).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          knowledgeBaseId: kb.id,
          content: "first",
          metadata: { source: "manual", page: 2 },
          embedding: `[${exactVector(0.5, 0.25).join(",")}]`,
          tokenCount: 10,
          createdAt: expect.any(Date),
        },
        {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          knowledgeBaseId: kb.id,
          content: "second",
          metadata: {},
          embedding: `[${exactVector(-0.75, 0.125).join(",")}]`,
          tokenCount: 11,
          createdAt: expect.any(Date),
        },
      ]);
      expect(embedding.embed).toHaveBeenCalledWith(["first", "second"]);
    });

    it("addChunks stores all chunks or none: one vector the column refuses leaves the base empty", async () => {
      const alice = await createUser(prisma);
      const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "A" } });
      vectors.set("fits", exactVector(0.5, 0.25));
      vectors.set("too short", [0.5, 0.25, 0]);

      await expect(
        service.addChunks(alice.id, kb.id, [{ content: "fits" }, { content: "too short" }]),
      ).rejects.toThrow();

      expect(await prisma.knowledgeChunk.count()).toBe(0);
    });

    it("uploadMarkdown uploads the file, stores one chunk per section with the S3 key in its metadata", async () => {
      const alice = await createUser(prisma);
      const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "A" } });
      const markdown = "Intro line\n# Setup\nInstall it.\n## Usage\nRun it.\n";
      const buffer = Buffer.from(markdown, "utf-8");
      const expectedKey = `knowledge/${alice.id}/${kb.id}/fixed-notes.md`;
      const expectedChunks = chunkMarkdown(markdown, "notes.md");

      const actual = await service.uploadMarkdown(alice.id, kb.id, { filename: "notes.md", buffer });

      expect(actual).toEqual({ filename: "notes.md", s3Key: expectedKey, chunksInserted: expectedChunks.length });
      expect(expectedChunks.length).toBe(3);
      expect(s3.upload).toHaveBeenCalledWith(expectedKey, buffer, "text/markdown");
      const stored = (await readStoredChunks()).sort(
        (left, right) => (left.metadata as { chunkIndex: number }).chunkIndex - (right.metadata as { chunkIndex: number }).chunkIndex,
      );
      expect(stored.map(({ content, metadata, knowledgeBaseId, embedding: vector, tokenCount }) => ({
        content,
        metadata,
        knowledgeBaseId,
        vector,
        tokenCount,
      }))).toEqual(
        expectedChunks
          .map((chunk, i) => ({
            content: chunk.content,
            metadata: { ...chunk.metadata, s3Key: expectedKey },
            knowledgeBaseId: kb.id,
            vector: `[${exactVector(0.5, 0.25).join(",")}]`,
            tokenCount: 10 + i,
          })),
      );
    });

    it("uploadMarkdown refuses a file that is not .md with 400 and stores nothing", async () => {
      const alice = await createUser(prisma);
      const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "A" } });

      await expect(
        service.uploadMarkdown(alice.id, kb.id, { filename: "notes.txt", buffer: Buffer.from("# x\ny") }),
      ).rejects.toThrow(BadRequestException);

      expect(s3.upload).not.toHaveBeenCalled();
      expect(await prisma.knowledgeChunk.count()).toBe(0);
    });

    it("listChunks: newest first, limit and offset, and the total of the base only", async () => {
      const alice = await createUser(prisma);
      const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "A" } });
      const other = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "B" } });
      await seedChunk({ id: "c1", knowledgeBaseId: kb.id, similarity: 0.1, createdAt: new Date("2026-01-01T00:00:01Z") });
      await seedChunk({ id: "c2", knowledgeBaseId: kb.id, similarity: 0.2, createdAt: new Date("2026-01-01T00:00:02Z") });
      await seedChunk({ id: "c3", knowledgeBaseId: kb.id, similarity: 0.3, createdAt: new Date("2026-01-01T00:00:03Z") });
      await seedChunk({ id: "x1", knowledgeBaseId: other.id, similarity: 0.4 });

      const all = await service.listChunks(alice.id, kb.id);
      const page = await service.listChunks(alice.id, kb.id, { limit: 1, offset: 1 });

      expect(all).toEqual({
        chunks: ["c3", "c2", "c1"].map((id, i) => ({
          id,
          content: `content of ${id}`,
          metadata: { tag: id },
          tokenCount: 5,
          createdAt: new Date(`2026-01-01T00:00:0${3 - i}Z`),
        })),
        total: 3,
      });
      expect(page).toEqual({ chunks: [expect.objectContaining({ id: "c2" })], total: 3 });
    });

    it("deleteChunk removes that chunk only", async () => {
      const alice = await createUser(prisma);
      const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "A" } });
      await seedChunk({ id: "keep", knowledgeBaseId: kb.id, similarity: 0.1 });
      await seedChunk({ id: "drop", knowledgeBaseId: kb.id, similarity: 0.2 });

      await service.deleteChunk(alice.id, kb.id, "drop");

      expect((await readStoredChunks()).map((c) => c.id)).toEqual(["keep"]);
    });
  });

  describe("knowledge bases", () => {
    it("create, list (personal bases of this user, newest first, with chunk counts), update and delete", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const workspace = await createWorkspace(prisma, { ownerId: alice.id });
      await prisma.knowledgeBase.create({ data: { userId: alice.id, workspaceId: workspace.id, name: "team" } });
      await prisma.knowledgeBase.create({ data: { userId: bob.id, name: "bob" } });

      const first = await service.createKnowledgeBase(alice.id, { name: "First" });
      const second = await service.createKnowledgeBase(alice.id, { name: "Second", description: "two" });
      await seedChunk({ id: "s1", knowledgeBaseId: second.id, similarity: 0.1 });
      const listed = await service.listKnowledgeBases(alice.id);
      const updated = await service.updateKnowledgeBase(alice.id, first.id, { name: "Renamed", active: false });
      await service.deleteKnowledgeBase(alice.id, second.id);

      expect(first).toMatchObject({ userId: alice.id, workspaceId: null, name: "First", description: null, isSystem: false, active: true });
      expect(second).toMatchObject({ name: "Second", description: "two" });
      expect(listed.map((kb) => [kb.name, kb._count.chunks])).toEqual([["Second", 1], ["First", 0]]);
      expect(updated).toMatchObject({ id: first.id, name: "Renamed", active: false, description: null });
      expect(await prisma.knowledgeBase.findUnique({ where: { id: second.id } })).toBeNull();
      expect(await prisma.knowledgeChunk.count()).toBe(0);
      expect(await service.getKnowledgeBase(alice.id, first.id)).toMatchObject({ name: "Renamed", _count: { chunks: 0 } });
    });
  });
});
