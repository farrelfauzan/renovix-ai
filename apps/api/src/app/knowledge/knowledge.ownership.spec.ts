import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";
import { EmbeddingService } from "./embedding.service";
import { S3Service } from "./s3.service";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser, createWorkspace } from "../../../test/factories";

// RX-15 characterization: knowledge base and chunk ownership on the API-key
// routes (/v1/knowledge, ApiKeyGuard) through the real controller and
// KnowledgeService on the test database. Embeddings never call a provider:
// EmbeddingService is a stub that returns a zero vector.
jest.mock("./embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("./s3.service", () => ({ S3Service: class {} }));

describe("Knowledge (/v1/knowledge, API key): ownership (RX-15, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const zero = () => ({ embedding: new Array(1024).fill(0), tokenCount: 1 });
  const embedding = {
    embed: jest.fn(async (texts: string[]) => texts.map(zero)),
    embedSingle: jest.fn(async () => zero()),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [KnowledgeController],
      providers: [
        KnowledgeService,
        { provide: EmbeddingService, useValue: embedding },
        { provide: S3Service, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    embedding.embed.mockClear();
  });

  afterAll(() => app?.close());

  const key = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });

  const setup = async () => {
    const alice = await createUser(prisma, { apiKey: "sk_live_alice" });
    const bob = await createUser(prisma, { apiKey: "sk_live_bob" });
    const kb = await prisma.knowledgeBase.create({
      data: { userId: alice.id, name: "Alice KB" },
    });
    const chunk = await prisma.knowledgeChunk.create({
      data: { knowledgeBaseId: kb.id, content: "Alice's private note", tokenCount: 3 },
    });
    return { alice, bob, kb, chunk };
  };

  it.each([
    ["no Authorization header", {}],
    ["a JWT instead of an API key", { authorization: `Bearer ${jwt.sign({ userId: "u" }, "any-secret")}` }],
  ])("not signed in (%s): GET /v1/knowledge/bases is 401", async (_case, headers: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/v1/knowledge/bases", headers });

    expect(res.statusCode).toBe(401);
  });

  it("owner can read and change their knowledge base and chunks (positive control)", async () => {
    const { kb, chunk } = await setup();

    const read = await app.inject({ method: "GET", url: `/v1/knowledge/bases/${kb.id}`, headers: key("sk_live_alice") });
    expect(read.statusCode).toBe(200);

    const chunks = await app.inject({
      method: "GET",
      url: `/v1/knowledge/bases/${kb.id}/chunks`,
      headers: key("sk_live_alice"),
    });
    expect(chunks.statusCode).toBe(200);
    expect(chunks.json().chunks).toEqual([expect.objectContaining({ id: chunk.id })]);

    const update = await app.inject({
      method: "PUT",
      url: `/v1/knowledge/bases/${kb.id}`,
      headers: key("sk_live_alice"),
      payload: { name: "Renamed by owner" },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().name).toBe("Renamed by owner");

    const delChunk = await app.inject({
      method: "DELETE",
      url: `/v1/knowledge/bases/${kb.id}/chunks/${chunk.id}`,
      headers: key("sk_live_alice"),
    });
    expect(delChunk.statusCode).toBe(204);
  });

  it("another user cannot read it: GET base and chunks are 403, the list leaves it out", async () => {
    const { kb } = await setup();

    const read = await app.inject({ method: "GET", url: `/v1/knowledge/bases/${kb.id}`, headers: key("sk_live_bob") });
    const chunks = await app.inject({
      method: "GET",
      url: `/v1/knowledge/bases/${kb.id}/chunks`,
      headers: key("sk_live_bob"),
    });
    const search = await app.inject({
      method: "POST",
      url: "/v1/knowledge/search",
      headers: key("sk_live_bob"),
      payload: { query: "note", knowledgeBaseId: kb.id },
    });
    const list = await app.inject({ method: "GET", url: "/v1/knowledge/bases", headers: key("sk_live_bob") });

    expect([read.statusCode, chunks.statusCode, search.statusCode]).toEqual([403, 403, 403]);
    expect(chunks.body).not.toContain("Alice's private note");
    expect(list.json()).toEqual([]);
  });

  it.each([
    ["PUT", "", { name: "Renamed by bob" }],
    ["DELETE", "", undefined],
    ["POST", "/chunks", { chunks: [{ content: "planted by bob" }] }],
  ] as const)("another user cannot change it: %s /v1/knowledge/bases/:id%s is 403, nothing changed", async (method, suffix, payload) => {
    const { kb } = await setup();

    const res = await app.inject({
      method,
      url: `/v1/knowledge/bases/${kb.id}${suffix}`,
      headers: key("sk_live_bob"),
      payload,
    });

    expect(res.statusCode).toBe(403);
    expect(await prisma.knowledgeBase.findUnique({ where: { id: kb.id } })).toMatchObject({ name: "Alice KB" });
    expect(await prisma.knowledgeChunk.count({ where: { knowledgeBaseId: kb.id } })).toBe(1);
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it("another user cannot delete a chunk: 403 through Alice's base, 404 through their own base", async () => {
    const { kb, chunk, bob } = await setup();
    const bobKb = await prisma.knowledgeBase.create({ data: { userId: bob.id, name: "Bob KB" } });

    const viaAlice = await app.inject({
      method: "DELETE",
      url: `/v1/knowledge/bases/${kb.id}/chunks/${chunk.id}`,
      headers: key("sk_live_bob"),
    });
    const viaOwn = await app.inject({
      method: "DELETE",
      url: `/v1/knowledge/bases/${bobKb.id}/chunks/${chunk.id}`,
      headers: key("sk_live_bob"),
    });

    expect([viaAlice.statusCode, viaOwn.statusCode]).toEqual([403, 404]);
    expect(await prisma.knowledgeChunk.count({ where: { id: chunk.id } })).toBe(1);
  });

  // Was HOLE (RX-15), fixed by RX-113: a workspace knowledge base keeps the
  // creator's userId, and /v1/knowledge only checked kb.userId, so a removed
  // workspace admin still read the base they created. /v1/knowledge now serves
  // personal bases only.
  it(
    "a removed workspace admin cannot read the workspace knowledge base they created",
    async () => {
      const owner = await createUser(prisma);
      const admin = await createUser(prisma, { apiKey: "sk_live_former_admin" });
      const workspace = await createWorkspace(prisma, { ownerId: owner.id });
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: admin.id, role: "admin", status: "removed" },
      });
      const kb = await prisma.knowledgeBase.create({
        data: { userId: admin.id, workspaceId: workspace.id, name: "Team KB" },
      });
      await prisma.knowledgeChunk.create({
        data: { knowledgeBaseId: kb.id, content: "added by another member", tokenCount: 4 },
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/knowledge/bases/${kb.id}/chunks`,
        headers: key("sk_live_former_admin"),
      });

      expect(res.body).not.toContain("added by another member");
      expect([403, 404]).toContain(res.statusCode);
    },
  );
});
