import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { ConversationController } from "./conversation.controller";
import { ConversationService } from "./conversation.service";
import { ProviderRouter } from "../providers/provider-router";
import { ModelRegistryService } from "../config/model-registry.service";
import { DocumentService } from "../document/document.service";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";

// RX-15 characterization: conversation ownership on the API-key routes
// (/conversations, ApiKeyGuard) through the real controller and
// ConversationService on the test database. No route here calls a model; the
// document service (ESM-only converters) is only used for stored documents.
jest.mock("../document/document.service", () => ({ DocumentService: class {} }));

describe("Conversations (/conversations, API key): ownership (RX-15, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
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
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const key = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });

  const setup = async () => {
    const alice = await createUser(prisma, { apiKey: "sk_live_alice" });
    const bob = await createUser(prisma, { apiKey: "sk_live_bob" });
    const conversation = await prisma.conversation.create({
      data: {
        userId: alice.id,
        model: "test-model",
        title: "Alice private chat",
        messages: { create: [{ role: "user", content: "Alice's secret" }] },
      },
    });
    return { alice, bob, conversation };
  };

  it.each([
    ["no Authorization header", {}],
    ["a JWT instead of an API key", { authorization: `Bearer ${jwt.sign({ userId: "u" }, "any-secret")}` }],
    ["an unknown key", { authorization: "Bearer sk_live_unknown" }],
  ])("not signed in (%s): GET /conversations is 401", async (_case, headers: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/conversations", headers });

    expect(res.statusCode).toBe(401);
  });

  it("owner can read and delete their conversation (positive control)", async () => {
    const { conversation } = await setup();

    const read = await app.inject({
      method: "GET",
      url: `/conversations/${conversation.id}`,
      headers: key("sk_live_alice"),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().messages).toEqual([
      expect.objectContaining({ role: "user", content: "Alice's secret" }),
    ]);

    const del = await app.inject({
      method: "DELETE",
      url: `/conversations/${conversation.id}`,
      headers: key("sk_live_alice"),
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.conversation.count()).toBe(0);
  });

  it("another user cannot read it: GET is 404 and the list leaves it out", async () => {
    const { conversation } = await setup();

    const read = await app.inject({
      method: "GET",
      url: `/conversations/${conversation.id}`,
      headers: key("sk_live_bob"),
    });
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain("Alice's secret");

    const list = await app.inject({ method: "GET", url: "/conversations", headers: key("sk_live_bob") });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ data: [], total: 0 });
  });

  it("another user cannot delete it: DELETE is 404, conversation kept", async () => {
    const { conversation } = await setup();

    const del = await app.inject({
      method: "DELETE",
      url: `/conversations/${conversation.id}`,
      headers: key("sk_live_bob"),
    });

    expect(del.statusCode).toBe(404);
    expect(await prisma.conversation.count({ where: { id: conversation.id } })).toBe(1);
  });
});
