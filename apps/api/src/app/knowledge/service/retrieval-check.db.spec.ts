import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TestingModule } from "@nestjs/testing";
import { KnowledgeService } from "./knowledge.service";
import { EmbeddingService } from "./embedding.service";
import { S3Service } from "./s3.service";
import { KnowledgeBaseRepository } from "../repository/knowledge-base.repository";
import { KnowledgeChunkRepository } from "../repository/knowledge-chunk.repository";
import { EMBEDDING_COLUMN_DIMENSIONS } from "../config/embedding-column-dimensions";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";

// RNX-27 AC2: the retrieval check set. A small test knowledge base (one chunk per answer plus distractors) is stored
// through KnowledgeService.addChunks and every question is asked through KnowledgeService.searchChunks, the same
// repository and SQL production uses; each question's expected chunk must be in the top 5. No API is called: the
// vectors come from fixtures/retrieval-check-vectors.json through an EmbeddingService test double under the fixture's
// model name. Until real vectors are recorded (scripts/retrieval-check-record-vectors.ts), that fixture is the
// "fixture-lexical" stand-in (scripts/retrieval-check-lexical-vectors.ts): it proves the harness and the search path,
// not the quality of text-embedding-3-large.
jest.mock("./embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("./s3.service", () => ({ S3Service: class {} }));

type CheckSet = {
  chunks: { id: string; content: string }[];
  questions: { id: string; language: string; question: string; expectedChunkId: string }[];
};
type VectorFixture = { model: string; dimensions: number; vectors: Record<string, number[]> };

const FIXTURES = resolve(__dirname, "../fixtures");
const checkSet: CheckSet = JSON.parse(readFileSync(resolve(FIXTURES, "retrieval-check-set.json"), "utf-8"));
const fixture: VectorFixture = JSON.parse(readFileSync(resolve(FIXTURES, "retrieval-check-vectors.json"), "utf-8"));
const TOP_K = 5;
const WRONG_MODEL = "another-embedding-model";

/** An EmbeddingService double that answers from the fixture map under `modelName`; an unknown text fails the test. */
const fixtureEmbedding = (modelName: string) => {
  const vectorOf = (text: string) => {
    const vector = fixture.vectors[text];
    if (!vector) throw new Error(`No fixture vector for: ${text}`);
    return { embedding: vector, tokenCount: 1 };
  };
  return {
    modelName,
    embed: jest.fn(async (texts: string[]) => texts.map(vectorOf)),
    embedSingle: jest.fn(async (text: string) => vectorOf(text)),
  };
};

describe("RNX-27 AC2: retrieval check set on the real search path (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: KnowledgeService;
  const s3 = {};

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        KnowledgeService,
        { provide: EmbeddingService, useValue: fixtureEmbedding(fixture.model) },
        { provide: S3Service, useValue: s3 },
      ],
    }));
    service = moduleRef.get(KnowledgeService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  /** Stores the check set's chunks in a new personal base through the real write path. */
  const seedCheckBase = async () => {
    const user = await createUser(prisma);
    const kb = await service.createKnowledgeBase(user.id, { name: "retrieval check" });
    await service.addChunks(user.id, kb.id, checkSet.chunks.map((chunk) => ({ content: chunk.content })));
    return { user, kb };
  };

  const contentOf = (chunkId: string) => checkSet.chunks.find((chunk) => chunk.id === chunkId)?.content;

  it("the fixture covers every chunk and question with a 1024-dimension vector; half the questions are Indonesian", () => {
    const texts = [...checkSet.chunks.map((chunk) => chunk.content), ...checkSet.questions.map((q) => q.question)];

    expect(texts.filter((text) => fixture.vectors[text]?.length !== EMBEDDING_COLUMN_DIMENSIONS)).toEqual([]);
    expect(fixture.dimensions).toBe(EMBEDDING_COLUMN_DIMENSIONS);
    expect(checkSet.questions.filter((q) => q.language === "id")).toHaveLength(checkSet.questions.length / 2);
    expect(checkSet.questions.every((q) => contentOf(q.expectedChunkId) !== undefined)).toBe(true);
  });

  it.each(checkSet.questions.map((q) => [q.id, q] as const))(
    "%s: the expected chunk is in the top 5",
    async (_id, question) => {
      const { user, kb } = await seedCheckBase();

      const actual = await service.searchChunks(user.id, question.question, { knowledgeBaseId: kb.id, topK: TOP_K });

      expect(actual.map((r) => r.content)).toContain(contentOf(question.expectedChunkId));
    },
  );

  it("wrong model (D83): chunks stored under the fixture's model, questions asked as another model → nothing, no error", async () => {
    const { user, kb } = await seedCheckBase();
    const asOtherModel = new KnowledgeService(
      fixtureEmbedding(WRONG_MODEL) as unknown as EmbeddingService,
      s3 as S3Service,
      moduleRef.get(KnowledgeBaseRepository),
      moduleRef.get(KnowledgeChunkRepository),
    );

    const actual = await Promise.all(
      checkSet.questions.map((q) => asOtherModel.searchChunks(user.id, q.question, { knowledgeBaseId: kb.id, topK: TOP_K })),
    );

    expect(actual.flat()).toEqual([]);
    expect(await prisma.knowledgeChunk.count({ where: { embeddingModel: fixture.model } })).toBe(checkSet.chunks.length);
  });
});
