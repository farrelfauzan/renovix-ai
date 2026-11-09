import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ConversationController } from "./conversation.controller";
import { ConversationService } from "../service/conversation.service";
import { ConversationRepository } from "../repository/conversation.repository";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { DocumentService } from "../../document/service/document.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";

// RX-136: the conversation routes and conditions that the ownership suite (RX-15,
// conversation.ownership.spec.ts) does not cover, written against the code before its queries moved
// into repositories: a caller who has a conversation of their own (so only the conversation id
// refuses), the list's order, paging and fields, and a stored document on a message. Real controller
// and ConversationService, test database; the document store is a stub.
// RNX-145: DELETE /conversations/:id soft-deletes (deletedAt, deletedById); the row, its messages and the user's usage
// rows stay; it is gone from the list, its total and every route, and comes back once the marker is cleared. `all` is
// a client with nothing on PrismaService's default filter map, to read the rows as they are.
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

describe("RX-136: conversation routes (/conversations, API key, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let all: PrismaService;
  const documentService = { getDocumentFromStorage: jest.fn() };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ConversationController],
      providers: [
        ConversationService,
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: DocumentService, useValue: documentService },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    documentService.getDocumentFromStorage.mockReset();
  });

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  const key = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });

  // Alice and Bob each have one conversation.
  const setup = async () => {
    const alice = await createUser(prisma);
    await createApiKey(prisma, alice.id, { apiKey: testApiKey("alice") });
    const bob = await createUser(prisma);
    await createApiKey(prisma, bob.id, { apiKey: testApiKey("bob") });
    const aliceConversation = await prisma.conversation.create({
      data: { userId: alice.id, model: "test-model", messages: { create: [{ role: "user", content: "Alice's secret" }] } },
    });
    const bobConversation = await prisma.conversation.create({
      data: { userId: bob.id, model: "test-model", messages: { create: [{ role: "user", content: "Bob's own" }] } },
    });
    return { alice, bob, aliceConversation, bobConversation };
  };

  describe("a caller who has a conversation of their own still cannot reach another user's (the id decides)", () => {
    it("GET /conversations/:id is 404, nothing of Alice's or Bob's in the body", async () => {
      const { aliceConversation } = await setup();

      const res = await app.inject({
        method: "GET",
        url: `/conversations/${aliceConversation.id}`,
        headers: key(testApiKey("bob")),
      });

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("Alice's secret");
      expect(res.body).not.toContain("Bob's own");
    });

    it("DELETE /conversations/:id is 404, both conversations kept", async () => {
      const { aliceConversation } = await setup();

      const res = await app.inject({
        method: "DELETE",
        url: `/conversations/${aliceConversation.id}`,
        headers: key(testApiKey("bob")),
      });

      expect(res.statusCode).toBe(404);
      expect(await prisma.conversation.count()).toBe(2);
    });
  });

  it("GET /conversations: the caller's conversations, most recently updated first, paged, with the total of the caller's", async () => {
    const { alice, aliceConversation } = await setup();
    const older = await prisma.conversation.create({
      data: { userId: alice.id, model: "m2", title: "Older", updatedAt: new Date(Date.now() - 60_000) },
    });

    const all = await app.inject({ method: "GET", url: "/conversations", headers: key(testApiKey("alice")) });
    const page = await app.inject({ method: "GET", url: "/conversations?limit=1&offset=1", headers: key(testApiKey("alice")) });

    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({ object: "list", total: 2, limit: 20, offset: 0 });
    expect(all.json().data.map((c: { id: string }) => c.id)).toEqual([aliceConversation.id, older.id]);
    expect(Object.keys(all.json().data[1]).sort()).toEqual(["createdAt", "id", "model", "title", "updatedAt"]);
    expect(all.json().data[1]).toMatchObject({ title: "Older", model: "m2" });
    expect(page.json()).toMatchObject({ total: 2, limit: 1, offset: 1, data: [{ id: older.id }] });
  });

  it("GET /conversations/:id: the messages oldest first, a stored document rehydrated", async () => {
    const alice = await createUser(prisma);
    await createApiKey(prisma, alice.id, { apiKey: testApiKey("alice") });
    const conversation = await prisma.conversation.create({
      data: { userId: alice.id, model: "test-model", title: "Mine" },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, role: "user", content: "first", createdAt: new Date(Date.now() - 60_000) },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: "second",
        documentFormat: "pdf",
        documentFilename: "a.pdf",
        documentKey: "documents/a.pdf",
      },
    });
    const stored = { format: "pdf", url: "https://files.invalid/a.pdf", filename: "a.pdf", expiresAt: "2026-12-01" };
    documentService.getDocumentFromStorage.mockResolvedValue(stored);

    const res = await app.inject({ method: "GET", url: `/conversations/${conversation.id}`, headers: key(testApiKey("alice")) });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: conversation.id, userId: alice.id, title: "Mine", model: "test-model" });
    expect(res.json().messages).toEqual([
      { id: expect.any(String), role: "user", content: "first", createdAt: expect.any(String) },
      { id: expect.any(String), role: "assistant", content: "second", createdAt: expect.any(String), document: stored },
    ]);
    expect(documentService.getDocumentFromStorage).toHaveBeenCalledWith({
      format: "pdf",
      filename: "a.pdf",
      key: "documents/a.pdf",
    });
  });

  describe("RNX-145: a deleted conversation", () => {
    const call = (method: "GET" | "DELETE", url: string, who = "alice") =>
      app.inject({ method, url, headers: key(testApiKey(who)) });

    /** Alice's two conversations (one with a message), a usage row of hers, and the rows as they are. */
    const seed = async () => {
      const s = await setup();
      const other = await prisma.conversation.create({ data: { userId: s.alice.id, model: "m2", title: "Other" } });
      await prisma.usageLog.create({
        data: { userId: s.alice.id, model: "test-model", inputTokens: 3, outputTokens: 4, cost: 0.01, latencyMs: 5, provider: "fake" },
      });
      return { ...s, other };
    };
    const readRows = async () => ({
      conversations: await all.conversation.findMany({ orderBy: { id: "asc" } }),
      messages: await all.message.findMany({ orderBy: { id: "asc" } }),
      usage: await all.usageLog.findMany({ orderBy: { id: "asc" } }),
    });

    it("RNX-145 AC1, AC9: DELETE answers 204 with no body as before; the row gets deletedAt and deletedById, its messages and the usage rows stay", async () => {
      const s = await seed();
      const before = await readRows();

      const res = await call("DELETE", `/conversations/${s.aliceConversation.id}`);

      expect([res.statusCode, res.body]).toEqual([204, ""]);
      const after = await readRows();
      expect(after.conversations.find((c) => c.id === s.aliceConversation.id)).toEqual({
        ...before.conversations.find((c) => c.id === s.aliceConversation.id),
        deletedAt: expect.any(Date),
        deletedById: s.alice.id,
        updatedAt: expect.any(Date),
      });
      expect(after.conversations.filter((c) => c.id !== s.aliceConversation.id)).toEqual(
        before.conversations.filter((c) => c.id !== s.aliceConversation.id),
      );
      expect(after.messages).toEqual(before.messages);
      expect(after.usage).toEqual(before.usage);
    });

    it("RNX-145 AC2, AC6: after the delete it is not listed or counted in the total, GET and DELETE answer 404 and change nothing; back once the marker is cleared", async () => {
      const s = await seed();
      await call("DELETE", `/conversations/${s.aliceConversation.id}`);
      const before = await readRows();

      const list = await call("GET", "/conversations");
      const read = await call("GET", `/conversations/${s.aliceConversation.id}`);
      const again = await call("DELETE", `/conversations/${s.aliceConversation.id}`);

      expect(list.json()).toMatchObject({ total: 1, data: [{ id: s.other.id }] });
      expect([read.statusCode, again.statusCode]).toEqual([404, 404]);
      expect(read.body).not.toContain("Alice's secret");
      expect(await readRows()).toEqual(before);
      await all.conversation.updateMany({ where: { id: s.aliceConversation.id }, data: { deletedAt: null, deletedById: null } });
      const listBack = await call("GET", "/conversations");
      const readBack = await call("GET", `/conversations/${s.aliceConversation.id}`);
      expect(listBack.json().total).toBe(2);
      expect(readBack.statusCode).toBe(200);
      expect(readBack.json().messages).toEqual([expect.objectContaining({ content: "Alice's secret" })]);
    });

    it("RNX-145 AC8: another user's DELETE answers 404 and marks nothing", async () => {
      const s = await seed();
      const before = await readRows();

      const res = await call("DELETE", `/conversations/${s.aliceConversation.id}`, "bob");

      expect(res.statusCode).toBe(404);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-145: the writes by id name deletedAt: null: a second soft delete and a title update of a deleted conversation answer 404 and change nothing; the title is written again once the marker is cleared", async () => {
      const s = await seed();
      const conversations = moduleRef.get(ConversationRepository);
      await conversations.softDeleteConversation(s.aliceConversation.id, s.alice.id);
      const before = await readRows();

      await expect(conversations.softDeleteConversation(s.aliceConversation.id, s.bob.id)).rejects.toMatchObject({ status: 404 });
      await expect(conversations.updateConversationTitle(s.aliceConversation.id, "Renamed")).rejects.toMatchObject({ status: 404 });

      expect(await readRows()).toEqual(before);
      await all.conversation.updateMany({ where: { id: s.aliceConversation.id }, data: { deletedAt: null, deletedById: null } });
      await conversations.updateConversationTitle(s.aliceConversation.id, "Renamed");
      expect(await all.conversation.findUnique({ where: { id: s.aliceConversation.id } })).toMatchObject({ title: "Renamed" });
    });
  });
});
