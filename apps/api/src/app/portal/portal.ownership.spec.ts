import { JwtModule, JwtService } from "@nestjs/jwt";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { PortalTierService } from "./portal-tier.service";
import { PortalGuard } from "./portal.guard";
import { PrismaService } from "../prisma/prisma.service";
import { ModelRegistryService } from "../config/model-registry.service";
import { ProviderRouter } from "../providers/provider-router";
import { BillingService } from "../billing/billing.service";
import { UsageService } from "../usage/usage.service";
import { PromptTuningService } from "../chat/prompt-tuning.service";
import { ConversationService } from "../chat/conversation.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { EmbeddingService } from "../knowledge/embedding.service";
import { S3Service } from "../knowledge/s3.service";
import { GuardrailService } from "../guardrail/guardrail.service";
import { DocumentService } from "../document/document.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";

// RX-15 characterization: conversation and knowledge ownership on the chat
// portal routes (PortalGuard, JWT path) through the real PortalController,
// ConversationService and KnowledgeService on the test database. No route here
// calls a model; the collaborators they do not use are empty stubs, and their
// modules are replaced because they load ESM-only packages.
jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../billing/billing.service", () => ({ BillingService: class {} }));
jest.mock("../usage/usage.service", () => ({ UsageService: class {} }));
jest.mock("../chat/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../guardrail/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../document/document.service", () => ({ DocumentService: class {} }));
jest.mock("../knowledge/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../knowledge/s3.service", () => ({ S3Service: class {} }));

const SESSION = "11111111-1111-4111-8111-111111111111";

describe("Portal conversations and knowledge: ownership (RX-15, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [JwtModule.register({ secret: "rx15-portal-jwt" })],
      controllers: [PortalController],
      providers: [
        PortalGuard,
        ConversationService,
        KnowledgeService,
        { provide: PortalTierService, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: ProviderRouter, useValue: {} },
        { provide: BillingService, useValue: {} },
        { provide: UsageService, useValue: {} },
        { provide: PromptTuningService, useValue: {} },
        { provide: GuardrailService, useValue: {} },
        { provide: DocumentService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const as = (user: { id: string }) => ({
    "x-portal-session": SESSION,
    authorization: `Bearer ${moduleRef.get(JwtService).sign({ userId: user.id, email: "x@test.local" })}`,
  });

  const setup = async () => {
    const alice = await createUser(prisma, { balance: 5 });
    const bob = await createUser(prisma, { balance: 5 });
    const conversation = await prisma.conversation.create({
      data: {
        userId: alice.id,
        model: "test-model",
        messages: { create: [{ role: "user", content: "Alice's secret" }] },
      },
    });
    const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "Alice KB" } });
    const chunk = await prisma.knowledgeChunk.create({
      data: { knowledgeBaseId: kb.id, content: "Alice's private note", tokenCount: 3 },
    });
    return { alice, bob, conversation, kb, chunk };
  };

  it.each([
    ["no X-Portal-Session header", {}],
    ["a portal session but no user (anonymous)", { "x-portal-session": SESSION }],
    ["an expired-or-invalid JWT (treated as anonymous)", { "x-portal-session": SESSION, authorization: "Bearer not.a.jwt" }],
  ])("not signed in (%s): portal conversation list is 400, not 401", async (_case, headers: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/chat/portal/conversations", headers });

    expect(res.statusCode).toBe(400);
  });

  it("owner can read their conversation and knowledge base, and delete both (positive control)", async () => {
    const { alice, conversation, kb } = await setup();

    const conv = await app.inject({ method: "GET", url: `/chat/portal/conversations/${conversation.id}`, headers: as(alice) });
    const chunks = await app.inject({ method: "GET", url: `/chat/portal/knowledge/${kb.id}/chunks`, headers: as(alice) });
    const delConv = await app.inject({ method: "DELETE", url: `/chat/portal/conversations/${conversation.id}`, headers: as(alice) });
    const delKb = await app.inject({ method: "DELETE", url: `/chat/portal/knowledge/${kb.id}`, headers: as(alice) });

    expect([conv.statusCode, chunks.statusCode, delConv.statusCode, delKb.statusCode]).toEqual([200, 200, 204, 204]);
    expect(conv.body).toContain("Alice's secret");
  });

  it("another user cannot read Alice's conversation (404) or knowledge chunks (403); lists leave them out", async () => {
    const { bob, conversation, kb } = await setup();

    const conv = await app.inject({ method: "GET", url: `/chat/portal/conversations/${conversation.id}`, headers: as(bob) });
    const chunks = await app.inject({ method: "GET", url: `/chat/portal/knowledge/${kb.id}/chunks`, headers: as(bob) });
    const convList = await app.inject({ method: "GET", url: "/chat/portal/conversations", headers: as(bob) });
    const kbList = await app.inject({ method: "GET", url: "/chat/portal/knowledge", headers: as(bob) });

    expect([conv.statusCode, chunks.statusCode]).toEqual([404, 403]);
    expect(conv.body + chunks.body).not.toMatch(/Alice's (secret|private note)/);
    expect(convList.json()).toMatchObject({ data: [], total: 0 });
    expect(kbList.json()).toEqual([]);
  });

  it("another user cannot delete Alice's conversation (404), knowledge base (403) or chunk (403)", async () => {
    const { bob, conversation, kb, chunk } = await setup();

    const delConv = await app.inject({ method: "DELETE", url: `/chat/portal/conversations/${conversation.id}`, headers: as(bob) });
    const delKb = await app.inject({ method: "DELETE", url: `/chat/portal/knowledge/${kb.id}`, headers: as(bob) });
    const delChunk = await app.inject({
      method: "DELETE",
      url: `/chat/portal/knowledge/${kb.id}/chunks/${chunk.id}`,
      headers: as(bob),
    });

    expect([delConv.statusCode, delKb.statusCode, delChunk.statusCode]).toEqual([404, 403, 403]);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.knowledgeChunk.count({ where: { id: chunk.id } })).toBe(1);
  });
});
