import { Readable } from "node:stream";
import { Logger } from "@nestjs/common";
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
/** RNX-27: the model the embedding stub stands for, and another one whose chunks a search must never return. */
const MODEL = "model-current";
const OTHER_MODEL = "model-other";

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
  const embedFixed = async (texts: string[]) =>
    texts.map((text, i) => ({ embedding: unitVector(0.5), tokenCount: text.length + i }));
  const embedding = {
    modelName: MODEL,
    embed: jest.fn(embedFixed),
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
    embedding.embed.mockImplementation(embedFixed);
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

  /** The database clock, which stamps embedded_at (now()). */
  const dbNow = async () => (await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;

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

    expect(actual).toEqual({ synced: 2, unchanged: 0, skipped: false });
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

    expect(actual).toEqual({ synced: 1, unchanged: 1, skipped: false });
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
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, "tokenCount", embedding_model, embedded_at)
      VALUES ('personal-1', ${personal.id}, 'mine', ${JSON.stringify({ s3Key: `${PREFIX}/a.md` })}::jsonb, 1, ${MODEL}, now())`;
    files = { [`${PREFIX}/a.md`]: { etag: '"e1"', body: "# A\nalpha\n" } };

    await service.sync();

    expect(await prisma.knowledgeChunk.findUnique({ where: { id: "personal-1" } })).not.toBeNull();
  });

  it("RNX-27: sync stores the embedding service's model and the embedding time on every chunk", async () => {
    files = { [`${PREFIX}/a.md`]: { etag: '"e1"', body: "# A\nalpha\n## A2\nmore alpha\n" } };
    const before = await dbNow();

    await service.sync();

    const after = await dbNow();
    const stored = await prisma.$queryRaw<{ embeddingModel: string; embeddedAt: Date }[]>`
      SELECT embedding_model AS "embeddingModel", embedded_at AS "embeddedAt" FROM "knowledge_chunks"`;
    expect(stored.map((c) => c.embeddingModel)).toEqual([MODEL, MODEL]);
    expect(stored.every((c) => c.embeddedAt >= before && c.embeddedAt <= after)).toBe(true);
  });

  it("RNX-27: an unchanged file whose chunks are another model's (or 'unknown') is re-embedded with the current model", async () => {
    const aBody = "# A\nalpha\n## A2\nmore alpha\n";
    files = { [`${PREFIX}/a.md`]: { etag: '"e1"', body: aBody } };
    await service.sync();
    await prisma.$executeRaw`UPDATE "knowledge_chunks" SET embedding_model = 'unknown'`;
    embedding.embed.mockClear();

    const actual = await service.sync();

    expect(actual).toEqual({ synced: 1, unchanged: 0, skipped: false });
    expect(embedding.embed).toHaveBeenCalledTimes(1);
    expect(await readSystemChunks()).toEqual(expectedRows(`${PREFIX}/a.md`, '"e1"', aBody));
    const models = await prisma.$queryRaw<{ embeddingModel: string }[]>`
      SELECT embedding_model AS "embeddingModel" FROM "knowledge_chunks"`;
    expect(models.map((c) => c.embeddingModel)).toEqual([MODEL, MODEL]);
  });

  describe("RNX-27: concurrent syncs (startup, hourly, several instances)", () => {
    /** Resolves once `condition` holds, polling the event loop. */
    const waitUntil = async (condition: () => boolean) => {
      for (let i = 0; i < 1000 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
      if (!condition()) throw new Error("condition not reached");
    };

    it("two syncs at once: one runs, the other skips with one log line and no error; the chunks are one sync's worth", async () => {
      const body = "# A\nalpha\n## A2\nmore alpha\n";
      files = { [`${PREFIX}/a.md`]: { etag: '"e1"', body } };
      let openGate: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (openGate = resolve));
      embedding.embed.mockImplementation(async (texts: string[]) => {
        if (embedding.embed.mock.calls.length >= 2) openGate();
        await gate;
        return embedFixed(texts);
      });
      const logged = jest.spyOn(Logger.prototype, "log");

      const first = service.sync();
      await waitUntil(() => embedding.embed.mock.calls.length === 1);
      const second = service.sync().finally(openGate);
      const actual = await Promise.all([first, second]);

      expect(actual).toEqual([
        { synced: 1, unchanged: 0, skipped: false },
        { synced: 0, unchanged: 0, skipped: true },
      ]);
      expect(embedding.embed).toHaveBeenCalledTimes(1);
      expect(await readSystemChunks()).toHaveLength(chunkMarkdown(body, `${PREFIX}/a.md`).length);
      expect(logged.mock.calls.filter(([line]) => String(line).includes("skipped"))).toHaveLength(1);
      logged.mockRestore();
    });

    it("control: a sync after the first one finished runs (the lock ends with the first sync)", async () => {
      files = { [`${PREFIX}/a.md`]: { etag: '"e1"', body: "# A\nalpha\n" } };
      await service.sync();
      files[`${PREFIX}/a.md`] = { etag: '"e2"', body: "# A\nbeta\n" };

      const actual = await service.sync();

      expect(actual).toEqual({ synced: 1, unchanged: 0, skipped: false });
    });
  });

  describe("searchSystemKB", () => {
    const seedSystemBase = async (active = true, model = MODEL) => {
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
          INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, embedding, "tokenCount", embedding_model, embedded_at)
          VALUES (${id}, ${kb.id}, ${`system ${id}`}, ${`[${unitVector(similarity).join(",")}]`}::vector, 1, ${model}, now())`;
      }
      await prisma.$executeRaw`
        INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, "tokenCount", embedding_model, embedded_at)
        VALUES ('no-vector', ${kb.id}, 'system no-vector', 1, ${MODEL}, now())`;
      const user = await createUser(prisma);
      const personal = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "mine" } });
      await prisma.$executeRaw`
        INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, embedding, "tokenCount", embedding_model, embedded_at)
        VALUES ('personal', ${personal.id}, 'personal s99', ${`[${unitVector(0.99).join(",")}]`}::vector, 1, ${MODEL}, now())`;
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

    it("RNX-27 negative: system chunks of another model are not returned (no error)", async () => {
      await seedSystemBase(true, OTHER_MODEL);

      const actual = await service.searchSystemKB(QUERY, { topK: 10, threshold: 0 });

      expect(actual).toEqual([]);
    });

    it("RNX-27: with chunks of both models, only the current model's chunks are returned", async () => {
      const kb = await seedSystemBase(true, OTHER_MODEL);
      await prisma.$executeRaw`
        INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, embedding, "tokenCount", embedding_model, embedded_at)
        VALUES ('current', ${kb.id}, 'system current s72', ${`[${unitVector(0.72).join(",")}]`}::vector, 1, ${MODEL}, now())`;

      const actual = await service.searchSystemKB(QUERY);

      expect(actual).toEqual([{ content: "system current s72", similarity: expect.closeTo(0.72, 5) }]);
    });

    it("an inactive system base: no results and no embedding", async () => {
      await seedSystemBase(false);

      const actual = await service.searchSystemKB(QUERY);

      expect(actual).toEqual([]);
      expect(embedding.embedSingle).not.toHaveBeenCalled();
    });
  });
});
