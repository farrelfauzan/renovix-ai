import { TestingModule } from "@nestjs/testing";
import { ConversationService } from "./conversation.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { DocumentService } from "../../document/service/document.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";

// RX-136: the ConversationService methods that only the chat completion run (ChatService) calls, so no
// route reaches them without a model: picking or creating the conversation, saving the messages and
// storing the title. Written against the code before its queries moved into repositories. Test
// database; no model is called (the registry lists none, so the title is the local fallback).
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

describe("RX-136: ConversationService (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ConversationService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      providers: [
        ConversationService,
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: { getAllModels: async () => [] } },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    service = moduleRef.get(ConversationService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  const createConversation = (userId: string) =>
    prisma.conversation.create({ data: { userId, model: "test-model" } });

  describe("getOrCreateConversation", () => {
    it("the caller's own conversation: its id, nothing created", async () => {
      const alice = await createUser(prisma);
      const own = await createConversation(alice.id);

      const actual = await service.getOrCreateConversation(alice.id, "other-model", own.id);

      expect(actual).toBe(own.id);
      expect(await prisma.conversation.count()).toBe(1);
    });

    it("another user's conversation: a new conversation of the caller", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const bobs = await createConversation(bob.id);

      const actual = await service.getOrCreateConversation(alice.id, "m1", bobs.id);

      expect(actual).not.toBe(bobs.id);
      expect(await prisma.conversation.findUnique({ where: { id: actual } })).toMatchObject({ userId: alice.id, model: "m1" });
    });

    it("another user's conversation while the caller has one: a new conversation, not the caller's", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const own = await createConversation(alice.id);
      const bobs = await createConversation(bob.id);

      const actual = await service.getOrCreateConversation(alice.id, "m1", bobs.id);

      expect([own.id, bobs.id]).not.toContain(actual);
      expect(await prisma.conversation.count({ where: { userId: alice.id } })).toBe(2);
    });

    it("no id: a new conversation of the caller with the model", async () => {
      const alice = await createUser(prisma);

      const actual = await service.getOrCreateConversation(alice.id, "m1");

      expect(await prisma.conversation.findUnique({ where: { id: actual } })).toMatchObject({
        userId: alice.id,
        model: "m1",
        title: null,
      });
    });
  });

  it("saveMessages stores the latest user message and the assistant reply with its document", async () => {
    const alice = await createUser(prisma);
    const conversation = await createConversation(alice.id);

    await service.saveMessages(
      conversation.id,
      [
        { role: "system", content: "s" },
        { role: "user", content: "first" },
        { role: "user", content: "latest" },
      ],
      "reply",
      { format: "pdf", filename: "a.pdf", key: "documents/a.pdf" },
    );

    const rows = await prisma.message.findMany({ orderBy: { role: "desc" } });
    expect(rows.map((m) => [m.conversationId, m.role, m.content, m.documentFormat, m.documentFilename, m.documentKey])).toEqual([
      [conversation.id, "user", "latest", null, null, null],
      [conversation.id, "assistant", "reply", "pdf", "a.pdf", "documents/a.pdf"],
    ]);
  });

  describe("generateTitle", () => {
    it("stores the title on that conversation only", async () => {
      const alice = await createUser(prisma);
      const conversation = await createConversation(alice.id);
      const other = await createConversation(alice.id);

      await service.generateTitle(conversation.id, "Here is the quarterly sales report for you.");

      const titled = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
      expect(titled.title).toEqual(expect.any(String));
      expect(titled.title).not.toBe("");
      expect((await prisma.conversation.findUniqueOrThrow({ where: { id: other.id } })).title).toBeNull();
    });

    it("a conversation deleted meanwhile: the failed update is logged, not thrown", async () => {
      await expect(
        service.generateTitle("00000000-0000-4000-8000-000000000000", "Here is the report."),
      ).resolves.toBeUndefined();
    });
  });
});
