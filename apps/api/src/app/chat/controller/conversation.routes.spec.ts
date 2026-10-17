import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ConversationController } from "./conversation.controller";
import { ConversationService } from "../service/conversation.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { DocumentService } from "../../document/service/document.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";

// RX-136: the conversation routes and conditions that the ownership suite (RX-15,
// conversation.ownership.spec.ts) does not cover, written against the code before its queries moved
// into repositories: a caller who has a conversation of their own (so only the conversation id
// refuses), the list's order, paging and fields, and a stored document on a message. Real controller
// and ConversationService, test database; the document store is a stub.
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

describe("RX-136: conversation routes (/conversations, API key, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
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
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    documentService.getDocumentFromStorage.mockReset();
  });

  afterAll(() => app?.close());

  const key = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });

  // Alice and Bob each have one conversation.
  const setup = async () => {
    const alice = await createUser(prisma, { apiKey: "sk_live_alice" });
    const bob = await createUser(prisma, { apiKey: "sk_live_bob" });
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
        headers: key("sk_live_bob"),
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
        headers: key("sk_live_bob"),
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

    const all = await app.inject({ method: "GET", url: "/conversations", headers: key("sk_live_alice") });
    const page = await app.inject({ method: "GET", url: "/conversations?limit=1&offset=1", headers: key("sk_live_alice") });

    expect(all.statusCode).toBe(200);
    expect(all.json()).toMatchObject({ object: "list", total: 2, limit: 20, offset: 0 });
    expect(all.json().data.map((c: { id: string }) => c.id)).toEqual([aliceConversation.id, older.id]);
    expect(Object.keys(all.json().data[1]).sort()).toEqual(["createdAt", "id", "model", "title", "updatedAt"]);
    expect(all.json().data[1]).toMatchObject({ title: "Older", model: "m2" });
    expect(page.json()).toMatchObject({ total: 2, limit: 1, offset: 1, data: [{ id: older.id }] });
  });

  it("GET /conversations/:id: the messages oldest first, a stored document rehydrated", async () => {
    const alice = await createUser(prisma, { apiKey: "sk_live_alice" });
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

    const res = await app.inject({ method: "GET", url: `/conversations/${conversation.id}`, headers: key("sk_live_alice") });

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
});
