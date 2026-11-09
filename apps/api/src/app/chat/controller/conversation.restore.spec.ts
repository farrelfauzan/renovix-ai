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
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";

// RNX-126: GET /conversations/deleted and POST /conversations/:id/restore (API key, the owner only, as
// DELETE /conversations/:id). Real controller and ConversationService on the test database; no route here calls a
// model. `all` reads the rows as they are.
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

describe("RNX-126: the owner lists and restores deleted conversations (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let all: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ConversationController],
      providers: [
        ConversationService,
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  const call = (method: "GET" | "POST" | "DELETE", url: string, seed: string) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${testApiKey(seed)}` } });
  const conversationRows = () => all.conversation.findMany({ orderBy: { id: "asc" } });

  const setup = async () => {
    const alice = await createUser(prisma);
    await createApiKey(prisma, alice.id, { apiKey: testApiKey("alice") });
    const bob = await createUser(prisma);
    await createApiKey(prisma, bob.id, { apiKey: testApiKey("bob") });
    const conversation = await prisma.conversation.create({
      data: { userId: alice.id, model: "test-model", title: "Alice chat", messages: { create: [{ role: "user", content: "Alice's secret" }] } },
    });
    return { alice, bob, conversation };
  };

  it("RNX-126: the list gives id, title, deletedAt and purgeAt = deletedAt + 30 days, newest-deleted first", async () => {
    const { alice, conversation } = await setup();
    const older = await prisma.conversation.create({ data: { userId: alice.id, model: "test-model", title: "Older" } });
    await all.conversation.update({ where: { id: older.id }, data: { deletedAt: new Date("2026-10-31T23:00:00.000Z"), deletedById: alice.id } });
    await all.conversation.update({ where: { id: conversation.id }, data: { deletedAt: new Date("2026-11-06T01:00:00.000Z"), deletedById: alice.id } });

    const res = await call("GET", "/conversations/deleted", "alice");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: conversation.id, title: "Alice chat", deletedAt: "2026-11-06T01:00:00.000Z", purgeAt: "2026-12-06T01:00:00.000Z" },
      { id: older.id, title: "Older", deletedAt: "2026-10-31T23:00:00.000Z", purgeAt: "2026-11-30T23:00:00.000Z" },
    ]);
  });

  it("RNX-126 AC1: after restore the conversation is back in the list and the read with its messages", async () => {
    const { conversation } = await setup();
    expect((await call("DELETE", `/conversations/${conversation.id}`, "alice")).statusCode).toBe(204);

    const res = await call("POST", `/conversations/${conversation.id}/restore`, "alice");

    expect([res.statusCode, res.json()]).toEqual([200, { id: conversation.id, title: "Alice chat" }]);
    expect((await call("GET", "/conversations/deleted", "alice")).json()).toEqual([]);
    expect((await call("GET", "/conversations", "alice")).json()).toMatchObject({ data: [{ id: conversation.id }], total: 1 });
    const read = await call("GET", `/conversations/${conversation.id}`, "alice");
    expect(read.json().messages).toEqual([expect.objectContaining({ role: "user", content: "Alice's secret" })]);
  });

  it("RNX-126 AC2: another user's deleted conversation is not listed and its restore answers 404; nothing changes", async () => {
    const { conversation } = await setup();
    expect((await call("DELETE", `/conversations/${conversation.id}`, "alice")).statusCode).toBe(204);
    const before = await conversationRows();

    const listed = await call("GET", "/conversations/deleted", "bob");
    const res = await call("POST", `/conversations/${conversation.id}/restore`, "bob");

    expect(listed.json()).toEqual([]);
    expect([res.statusCode, res.json().message]).toEqual([404, "Conversation not found"]);
    expect(await conversationRows()).toEqual(before);
  });

  it("RNX-126 AC3: restore on a live conversation answers 404; nothing changes", async () => {
    const { conversation } = await setup();
    const before = await conversationRows();

    const res = await call("POST", `/conversations/${conversation.id}/restore`, "alice");

    expect([res.statusCode, res.json().message]).toEqual([404, "Conversation not found"]);
    expect(await conversationRows()).toEqual(before);
  });
});
