import { TestingModule } from "@nestjs/testing";
import { WorkspaceKnowledgeService } from "./workspace-knowledge.service";
import { WorkspaceQuotaService } from "./workspace-quota.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createWorkspace } from "../../../../test/factories";

// RNX-27: the workspace knowledge paths store the embedding model with every chunk and compare only vectors of the
// current model. Test database; the embedding stub returns fixed vectors under a fixed model name, S3 is a stub.
// A document vector [a, sqrt(1 - a^2), 0, ...] against the query vector [1, 0, ...] has cosine similarity a.
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const DIMENSIONS = 1024;
const QUERY = "fixed query";
const MODEL = "model-current";
const OTHER_MODEL = "model-other";

/** A 1024-dimension unit vector with cosine similarity `similarity` to the query vector. */
const unitVector = (similarity: number) => {
  const vector = new Array(DIMENSIONS).fill(0);
  vector[0] = similarity;
  vector[1] = Math.sqrt(1 - similarity * similarity);
  return vector;
};

describe("RNX-27: WorkspaceKnowledgeService and the embedding model (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: WorkspaceKnowledgeService;
  const embedding = {
    modelName: MODEL,
    embed: jest.fn(async (texts: string[]) => texts.map(() => ({ embedding: unitVector(0.5), tokenCount: 1 }))),
    embedSingle: jest.fn(async () => ({ embedding: unitVector(1), tokenCount: 1 })),
  };
  const s3 = { buildKey: () => "knowledge/workspace/fixed.md", upload: async () => undefined, delete: async () => undefined };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        WorkspaceKnowledgeService,
        { provide: EmbeddingService, useValue: embedding },
        { provide: S3Service, useValue: s3 },
        { provide: WorkspaceQuotaService, useValue: {} },
      ],
    }));
    service = moduleRef.get(WorkspaceKnowledgeService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
  });

  afterAll(() => moduleRef?.close());

  /** The database clock, which stamps embedded_at (now()). */
  const dbNow = async () => (await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now;

  const readStoredModels = () =>
    prisma.$queryRaw<{ embeddingModel: string; embeddedAt: Date }[]>`
      SELECT embedding_model AS "embeddingModel", embedded_at AS "embeddedAt" FROM "knowledge_chunks" ORDER BY content`;

  const seedChunk = (id: string, knowledgeBaseId: string, similarity: number, model = MODEL) =>
    prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt", embedding_model, embedded_at)
      VALUES (${id}, ${knowledgeBaseId}, ${`content of ${id}`}, '{}'::jsonb, ${`[${unitVector(similarity).join(",")}]`}::vector, 1, now(), ${model}, now())`;

  const seedWorkspaceBase = async () => {
    const owner = await createUser(prisma);
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const kb = await prisma.knowledgeBase.create({ data: { userId: owner.id, workspaceId: workspace.id, name: "team" } });
    return { owner, workspace, kb };
  };

  /** A workspace base with chunks of the current model and closer chunks of another model. */
  const seedMixedModels = async () => {
    const seeded = await seedWorkspaceBase();
    await seedChunk("other-s99", seeded.kb.id, 0.99, OTHER_MODEL);
    await seedChunk("current-s50", seeded.kb.id, 0.5);
    await seedChunk("current-s30", seeded.kb.id, 0.3);
    return seeded;
  };

  it("uploadMarkdown stores the embedding service's model and the embedding time on every chunk", async () => {
    const { owner, workspace, kb } = await seedWorkspaceBase();
    const before = await dbNow();

    await service.uploadMarkdown(workspace.id, kb.id, owner.id, { filename: "notes.md", buffer: Buffer.from("# One\na\n# Two\nb\n") });

    const after = await dbNow();
    const stored = await readStoredModels();
    expect(stored.map((c) => c.embeddingModel)).toEqual([MODEL, MODEL]);
    expect(stored.every((c) => c.embeddedAt >= before && c.embeddedAt <= after)).toBe(true);
  });

  it("addChunks stores the embedding service's model and the embedding time on every chunk", async () => {
    const { owner, workspace, kb } = await seedWorkspaceBase();
    const before = await dbNow();

    await service.addChunks(workspace.id, kb.id, owner.id, [{ content: "first" }, { content: "second" }]);

    const after = await dbNow();
    const stored = await readStoredModels();
    expect(stored.map((c) => c.embeddingModel)).toEqual([MODEL, MODEL]);
    expect(stored.every((c) => c.embeddedAt >= before && c.embeddedAt <= after)).toBe(true);
  });

  it("searchWorkspaceKnowledge: only chunks of the current model, even when another model's chunk is closer", async () => {
    const { workspace } = await seedMixedModels();

    const actual = await service.searchWorkspaceKnowledge(workspace.id, QUERY);

    expect(actual.map((r) => r.id)).toEqual(["current-s50", "current-s30"]);
  });

  it("searchKnowledgeBase: only chunks of the current model, even when another model's chunk is closer", async () => {
    const { kb } = await seedMixedModels();

    const actual = await service.searchKnowledgeBase(kb.id, QUERY, 5);

    expect(actual.map((r) => r.id)).toEqual(["current-s50", "current-s30"]);
  });

  it("negative: chunks that are all of another model return nothing (no error) on both search paths", async () => {
    const { workspace, kb } = await seedWorkspaceBase();
    await seedChunk("other-s99", kb.id, 0.99, OTHER_MODEL);

    const workspaceWide = await service.searchWorkspaceKnowledge(workspace.id, QUERY);
    const oneBase = await service.searchKnowledgeBase(kb.id, QUERY, 5);

    expect({ workspaceWide, oneBase }).toEqual({ workspaceWide: [], oneBase: [] });
  });
});
