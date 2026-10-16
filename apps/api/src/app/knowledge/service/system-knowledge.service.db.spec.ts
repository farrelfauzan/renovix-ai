import { Readable } from "node:stream";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { SystemKnowledgeService } from "./system-knowledge.service";
import { EmbeddingService } from "./embedding.service";
import { chunkMarkdown } from "../utils/markdown-chunker";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";

// RX-137: the system knowledge base's chunk storage (sync) and search on the test database, written before
// the knowledge module's queries moved into repositories. Nothing external runs: the S3 client is a mock
// that serves fixed files, and the embedding stub returns fixed vectors (see knowledge.service.db.spec.ts).
const mockS3Send = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockS3Send;
  },
  ListObjectsV2Command: class {
    readonly kind = "list";
    constructor(readonly input: unknown) {}
  },
  GetObjectCommand: class {
    readonly kind = "get";
    constructor(readonly input: { Key: string }) {}
  },
}));
jest.mock("./embedding.service", () => ({ EmbeddingService: class {} }));

const DIMENSIONS = 1024;
const QUERY = "fixed query";
const PREFIX = "renovix-rag-docs";

const unitVector = (similarity: number) => {
  const vector = new Array(DIMENSIONS).fill(0);
  vector[0] = similarity;
  vector[1] = Math.sqrt(1 - similarity * similarity);
  return vector;
};

describe("SystemKnowledgeService: sync storage and search (RX-137, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: SystemKnowledgeService;
  let files: Record<string, { etag: string; body: string; size?: number }>;
  const embedding = {
    embed: jest.fn(async (texts: string[]) =>
      texts.map((text, i) => ({ embedding: unitVector(0.5), tokenCount: text.length + i })),
    ),
    embedSingle: jest.fn(async () => ({ embedding: unitVector(1), tokenCount: 2 })),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              S3_BUCKET: "test-bucket",
              S3_REGION: "test-region",
              S3_ACCESS_KEY_ID: "test",
              S3_SECRET_ACCESS_KEY: "test",
            }),
          ],
        }),
      ],
      providers: [SystemKnowledgeService, { provide: EmbeddingService, useValue: embedding }],
    }));
    service = moduleRef.get(SystemKnowledgeService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    files = {};
    mockS3Send.mockImplementation(async (command: { kind: string; input: { Key: string } }) => {
      if (command.kind === "list") {
        return {
          Contents: Object.entries(files).map(([Key, file]) => ({
            Key,
            ETag: file.etag,
            Size: file.size ?? file.body.length,
          })),
        };
      }
      return { Body: Readable.from([Buffer.from(files[command.input.Key].body, "utf-8")]) };
    });
  });

  afterAll(() => moduleRef?.close());

  const readSystemChunks = () =>
    prisma.$queryRaw<{ id: string; content: string; metadata: Record<string, unknown>; embedding: string; tokenCount: number }[]>`
      SELECT kc.id, kc.content, kc.metadata, kc.embedding::text AS embedding, kc."tokenCount"
      FROM "knowledge_chunks" kc JOIN "knowledge_bases" kb ON kb.id = kc."knowledgeBaseId"
      WHERE kb.is_system = true ORDER BY kc.metadata->>'s3Key', (kc.metadata->>'chunkIndex')::int`;

  const expectedRows = (key: string, etag: string, body: string) =>
    chunkMarkdown(body, key).map((chunk, i) => ({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      content: chunk.content,
      metadata: { ...chunk.metadata, s3Key: key, etag },
      embedding: expect.stringMatching(/^\[0\.5,0\.8660254,0,/),
      tokenCount: chunk.content.length + i,
    }));

  it("sync creates the system base and stores every non-empty .md file's chunks with its S3 key and ETag", async () => {
    const aBody = "# A\nalpha\n## A2\nmore alpha\n";
    const bBody = "# B\nbeta\n";
    files = {
      [`${PREFIX}/a.md`]: { etag: '"e1"', body: aBody },
      [`${PREFIX}/b.md`]: { etag: '"e2"', body: bBody },
      [`${PREFIX}/empty.md`]: { etag: '"e3"', body: "", size: 0 },
      [`${PREFIX}/c.txt`]: { etag: '"e4"', body: "# C\ngamma\n" },
    };

    const actual = await service.sync();

    expect(actual).toEqual({ synced: 2, unchanged: 0 });
    expect(await prisma.knowledgeBase.findMany()).toEqual([
      expect.objectContaining({
        name: "Renovix AI System Knowledge",
        description: "System knowledge base for Renovix AI product information",
        isSystem: true,
        active: true,
        userId: null,
        workspaceId: null,
      }),
    ]);
    expect(await readSystemChunks()).toEqual([
      ...expectedRows(`${PREFIX}/a.md`, '"e1"', aBody),
      ...expectedRows(`${PREFIX}/b.md`, '"e2"', bBody),
    ]);
  });

  it("sync again: an unchanged ETag is skipped, a changed file's chunks are replaced, other chunks stay", async () => {
    const bBody = "# B\nbeta\n";
    files = {
      [`${PREFIX}/a.md`]: { etag: '"e1"', body: "# A\nalpha\n## A2\nmore alpha\n" },
      [`${PREFIX}/b.md`]: { etag: '"e2"', body: bBody },
    };
    await service.sync();
    const bIdsBefore = (await readSystemChunks()).filter((c) => c.metadata.s3Key === `${PREFIX}/b.md`).map((c) => c.id);
    const newABody = "# A new\nonly section\n";
    files[`${PREFIX}/a.md`] = { etag: '"e1b"', body: newABody };
    embedding.embed.mockClear();

    const actual = await service.sync();

    expect(actual).toEqual({ synced: 1, unchanged: 1 });
    expect(await prisma.knowledgeBase.count()).toBe(1);
    expect(embedding.embed).toHaveBeenCalledTimes(1);
    const stored = await readSystemChunks();
    expect(stored).toEqual([
      ...expectedRows(`${PREFIX}/a.md`, '"e1b"', newABody),
      ...expectedRows(`${PREFIX}/b.md`, '"e2"', bBody),
    ]);
    expect(stored.filter((c) => c.metadata.s3Key === `${PREFIX}/b.md`).map((c) => c.id)).toEqual(bIdsBefore);
  });

  it("sync keeps a non-system base's chunks that carry the same S3 key", async () => {
    const user = await createUser(prisma);
    const personal = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "mine" } });
    await prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, "tokenCount")
      VALUES ('personal-1', ${personal.id}, 'mine', ${JSON.stringify({ s3Key: `${PREFIX}/a.md` })}::jsonb, 1)`;
    files = { [`${PREFIX}/a.md`]: { etag: '"e1"', body: "# A\nalpha\n" } };

    await service.sync();

    expect(await prisma.knowledgeChunk.findUnique({ where: { id: "personal-1" } })).not.toBeNull();
  });

  describe("searchSystemKB", () => {
    const seedSystemBase = async (active = true) => {
      const kb = await prisma.knowledgeBase.create({ data: { name: "sys", isSystem: true, active } });
      for (const [id, similarity] of [
        ["s75", 0.75],
        ["s95", 0.95],
        ["s65", 0.65],
        ["s85", 0.85],
        ["s80", 0.8],
        ["s50", 0.5],
      ] as const) {
        await prisma.$executeRaw`
          INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, embedding, "tokenCount")
          VALUES (${id}, ${kb.id}, ${`system ${id}`}, ${`[${unitVector(similarity).join(",")}]`}::vector, 1)`;
      }
      await prisma.$executeRaw`
        INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, "tokenCount")
        VALUES ('no-vector', ${kb.id}, 'system no-vector', 1)`;
      const user = await createUser(prisma);
      const personal = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "mine" } });
      await prisma.$executeRaw`
        INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, embedding, "tokenCount")
        VALUES ('personal', ${personal.id}, 'personal s99', ${`[${unitVector(0.99).join(",")}]`}::vector, 1)`;
      return kb;
    };

    it("defaults: the 3 closest system chunks with similarity >= 0.7, closest first", async () => {
      await seedSystemBase();

      const actual = await service.searchSystemKB(QUERY);

      expect(actual).toEqual([
        { content: "system s95", similarity: expect.closeTo(0.95, 5) },
        { content: "system s85", similarity: expect.closeTo(0.85, 5) },
        { content: "system s80", similarity: expect.closeTo(0.8, 5) },
      ]);
      expect(embedding.embedSingle).toHaveBeenCalledWith(QUERY);
    });

    it("topK 10 and threshold 0.6: every system chunk at or above 0.6, closest first", async () => {
      await seedSystemBase();

      const actual = await service.searchSystemKB(QUERY, { topK: 10, threshold: 0.6 });

      expect(actual.map((r) => r.content)).toEqual([
        "system s95",
        "system s85",
        "system s80",
        "system s75",
        "system s65",
      ]);
    });

    it("an inactive system base: no results and no embedding", async () => {
      await seedSystemBase(false);

      const actual = await service.searchSystemKB(QUERY);

      expect(actual).toEqual([]);
      expect(embedding.embedSingle).not.toHaveBeenCalled();
    });
  });
});
