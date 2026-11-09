import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "../service/knowledge.service";
import { EmbeddingService } from "../service/embedding.service";
import { S3Service } from "../service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createWorkspace, createApiKey, testApiKey } from "../../../../test/factories";

// RNX-126: GET /v1/knowledge/bases/deleted and POST /v1/knowledge/bases/:id/restore (API key, the owner only, as
// DELETE /v1/knowledge/bases/:id). Personal bases only; a workspace base has its own routes (workspace.restore.spec.ts).
// Real controller and KnowledgeService on the test database; embeddings are a stub. `all` reads the rows as they are.
jest.mock("../service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../service/s3.service", () => ({ S3Service: class {} }));

describe("RNX-126: the owner lists and restores deleted personal knowledge bases (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let all: PrismaService;
  let app: NestFastifyApplication;
  const ones = () => ({ embedding: new Array(1024).fill(1), tokenCount: 1 });
  const embedding = {
    modelName: "test-model",
    embed: jest.fn(async (texts: string[]) => texts.map(ones)),
    embedSingle: jest.fn(async () => ones()),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [KnowledgeController],
      providers: [KnowledgeService, { provide: EmbeddingService, useValue: embedding }, { provide: S3Service, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  const key = (seed: string) => ({ authorization: `Bearer ${testApiKey(seed)}` });
  const call = (method: "GET" | "POST" | "DELETE", url: string, seed: string, payload?: object) =>
    app.inject({ method, url, headers: key(seed), payload });
  const ids = async (url: string, seed: string) => (await call("GET", url, seed)).json().map((row: { id: string }) => row.id);
  const kbRows = () => all.knowledgeBase.findMany({ orderBy: { id: "asc" } });

  const setup = async () => {
    const alice = await createUser(prisma);
    await createApiKey(prisma, alice.id, { apiKey: testApiKey("alice") });
    const bob = await createUser(prisma);
    await createApiKey(prisma, bob.id, { apiKey: testApiKey("bob") });
    const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "Alice KB" } });
    const chunk = await prisma.knowledgeChunk.create({
      data: { knowledgeBaseId: kb.id, content: "Alice's note", tokenCount: 3, embeddingModel: "test-model", embeddedAt: new Date() },
    });
    return { alice, bob, kb, chunk };
  };

  it("RNX-126: the list gives id, name, deletedAt and purgeAt = deletedAt + 30 days, newest-deleted first", async () => {
    const { alice, kb } = await setup();
    const older = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "Older" } });
    await all.knowledgeBase.update({ where: { id: older.id }, data: { deletedAt: new Date("2026-10-30T00:00:00.000Z"), deletedById: alice.id } });
    await all.knowledgeBase.update({ where: { id: kb.id }, data: { deletedAt: new Date("2026-11-04T06:00:00.000Z"), deletedById: alice.id } });

    const res = await call("GET", "/v1/knowledge/bases/deleted", "alice");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: kb.id, name: "Alice KB", deletedAt: "2026-11-04T06:00:00.000Z", purgeAt: "2026-12-04T06:00:00.000Z" },
      { id: older.id, name: "Older", deletedAt: "2026-10-30T00:00:00.000Z", purgeAt: "2026-11-29T00:00:00.000Z" },
    ]);
  });

  it("RNX-126 AC1: after restore the knowledge base is back in the list and the read with its chunks, and searchable", async () => {
    const { kb } = await setup();
    expect((await call("POST", `/v1/knowledge/bases/${kb.id}/chunks`, "alice", { chunks: [{ content: "embedded note" }] })).statusCode).toBe(201);
    const searchIds = async () => (await call("POST", "/v1/knowledge/search", "alice", { query: "note" })).json().map((row: { id: string }) => row.id);
    const found = await searchIds();
    expect(found).toHaveLength(1);
    expect((await call("DELETE", `/v1/knowledge/bases/${kb.id}`, "alice")).statusCode).toBe(204);
    expect(await ids("/v1/knowledge/bases/deleted", "alice")).toEqual([kb.id]);
    expect(await searchIds()).toEqual([]);

    const res = await call("POST", `/v1/knowledge/bases/${kb.id}/restore`, "alice");

    expect([res.statusCode, res.json()]).toEqual([200, { id: kb.id, name: "Alice KB" }]);
    expect(await ids("/v1/knowledge/bases/deleted", "alice")).toEqual([]);
    expect(await ids("/v1/knowledge/bases", "alice")).toEqual([kb.id]);
    expect((await call("GET", `/v1/knowledge/bases/${kb.id}`, "alice")).json()._count).toEqual({ chunks: 2 });
    expect(await searchIds()).toEqual(found);
  });

  it("RNX-126 AC2: another user's deleted knowledge base is not listed and its restore answers 404; nothing changes", async () => {
    const { kb } = await setup();
    expect((await call("DELETE", `/v1/knowledge/bases/${kb.id}`, "alice")).statusCode).toBe(204);
    const before = await kbRows();

    const listed = await ids("/v1/knowledge/bases/deleted", "bob");
    const res = await call("POST", `/v1/knowledge/bases/${kb.id}/restore`, "bob");

    expect(listed).toEqual([]);
    expect([res.statusCode, res.json().message]).toEqual([404, "Knowledge base not found"]);
    expect(await kbRows()).toEqual(before);
  });

  it("RNX-126 AC3: restore on a live knowledge base answers 404; nothing changes", async () => {
    const { kb } = await setup();
    const before = await kbRows();

    const res = await call("POST", `/v1/knowledge/bases/${kb.id}/restore`, "alice");

    expect([res.statusCode, res.json().message]).toEqual([404, "Knowledge base not found"]);
    expect(await kbRows()).toEqual(before);
  });

  it("RNX-126: a deleted workspace base of the user is not listed here and its restore here answers 404; nothing changes", async () => {
    const { alice } = await setup();
    const workspace = await createWorkspace(prisma, { ownerId: alice.id });
    const workspaceKb = await prisma.knowledgeBase.create({ data: { userId: alice.id, workspaceId: workspace.id, name: "Team KB" } });
    await all.knowledgeBase.update({ where: { id: workspaceKb.id }, data: { deletedAt: new Date(), deletedById: alice.id } });
    const before = await kbRows();

    const listed = await ids("/v1/knowledge/bases/deleted", "alice");
    const res = await call("POST", `/v1/knowledge/bases/${workspaceKb.id}/restore`, "alice");

    expect(listed).toEqual([]);
    expect(res.statusCode).toBe(404);
    expect(await kbRows()).toEqual(before);
  });
});
