import { randomUUID } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { WorkspaceChannelController } from "./workspace-channel.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { WorkspaceKnowledgeService } from "../service/workspace-knowledge.service";
import { KnowledgeController } from "../../knowledge/controller/knowledge.controller";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { AgentController } from "../../agent/controller/agent.controller";
import { AgentService } from "../../agent/service/agent.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { PortalController } from "../../portal/controller/portal.controller";
import { PortalTierService } from "../../portal/service/portal-tier.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProviderRouter } from "../../providers/provider-router";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AgentRepository } from "../../agent/repository/agent.repository";
import { AgentChannelRepository } from "../../agent/repository/agent-channel.repository";
import { ChannelAgentRepository } from "../../channel/repository/channel-agent.repository";
import { KnowledgeBaseRepository } from "../../knowledge/repository/knowledge-base.repository";
import { KnowledgeChunkRepository } from "../../knowledge/repository/knowledge-chunk.repository";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  createAgent,
  createApiKey,
  createPackageSnapshot,
  createUser,
  createWorkspace,
} from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { asSessionUser } from "../../../../test/as-session-user";

// RX-113 (D63): a workspace knowledge base belongs to the workspace and access
// follows CURRENT membership. Only the owner adds a base; the personal routes
// (/v1/knowledge, /chat/portal/knowledge) serve personal bases only; a
// workspace base is attached to an agent only by a current owner or admin and
// only to an agent of that workspace. Real controllers and services on the
// test database; embeddings are a fixed unit vector (no provider call), S3 and
// email are never reached.
// RNX-145: a deleted knowledge base (personal, or of a workspace) keeps its row, chunks and agent links; it is gone from
// every list, route, search and agent knowledge base list, and back once the marker is cleared. `all` is a client
// with nothing on PrismaService's default filter map, to read the rows as they are.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

const SESSION = "11111111-1111-4111-8111-111111111111";
const SECRET = "team secret written by another member";
const unit = () => {
  const v = new Array(1024).fill(0);
  v[0] = 1;
  return v;
};
const VECTOR = `[${unit().join(",")}]`;

describe("Workspace knowledge bases: access follows current membership (RX-113, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let all: PrismaService;
  const embedding = {
    modelName: "test-model",
    embed: jest.fn(async (texts: string[]) => texts.map(() => ({ embedding: unit(), tokenCount: 1 }))),
    embedSingle: jest.fn(async () => ({ embedding: unit(), tokenCount: 1 })),
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [KnowledgeController, WorkspaceChannelController, AgentController, PortalController],
      providers: [
        KnowledgeService,
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        WorkspaceKnowledgeService,
        AgentService,
        EntitlementService,
        AgentRunPolicyService,
        ConversationService,
        { provide: EmbeddingService, useValue: embedding },
        { provide: S3Service, useValue: {} },
        { provide: EmailJobService, useValue: {} },
        { provide: ProviderRouter, useValue: {} },
        { provide: PortalTierService, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: CreditService, useValue: {} },
        { provide: UsageService, useValue: {} },
        { provide: PromptTuningService, useValue: {} },
        { provide: GuardrailService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    // like main.ts: multipart is needed for the upload routes
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.getHttpAdapter().getInstance().register(require("@fastify/multipart"));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    all = PrismaService.create({});
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    embedding.embed.mockClear();
  });

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  const sessionAuth = (user: { id: string; email: string }) => asSessionUser(user);
  const portal = (user: { id: string; email: string }) => ({
    "x-portal-session": SESSION,
    ...asSessionUser(user),
  });
  const apiKey = (user: { apiKey: string }) => ({ authorization: `Bearer ${user.apiKey}` });

  const insertChunk = async (knowledgeBaseId: string, content: string) => {
    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (id, "knowledgeBaseId", content, metadata, embedding, "tokenCount", "createdAt", embedding_model, embedded_at)
      VALUES (${id}, ${knowledgeBaseId}, ${content}, '{}'::jsonb, ${VECTOR}::vector, 1, now(), ${embedding.modelName}, now())`;
    return id;
  };

  // An Enterprise owner's workspace (so only membership decides), with a base
  // created by a former admin whose member row has since been deleted.
  /**
   * A user whose paid wallet holds 5 credits on the ledger (RX-22: the portal reads the ledger, not User.balance),
   * with an API key (RNX-18: stored hashed by createApiKey; the plaintext is returned as `apiKey`).
   */
  const fundedUser = async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    return { ...user, apiKey: await createApiKey(prisma, user.id) };
  };

  const setup = async () => {
    const owner = await fundedUser();
    const admin = await fundedUser();
    const member = await fundedUser();
    const former = await fundedUser();
    // RNX-76 B3 (D297): collaboration comes from the owner's package snapshot, not the plan.
    await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
    const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
    const workspace = await createWorkspace(prisma, { ownerId: owner.id, channelId: channel.id });
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: workspace.id, userId: owner.id, role: "owner", status: "active" },
        { workspaceId: workspace.id, userId: admin.id, role: "admin", status: "active" },
        { workspaceId: workspace.id, userId: member.id, role: "member", status: "active" },
      ],
    });
    const kb = await prisma.knowledgeBase.create({
      data: { userId: former.id, workspaceId: workspace.id, name: "Team KB" },
    });
    const chunkId = await insertChunk(kb.id, SECRET);
    const formerWorkspaceAgent = await createAgent(prisma, { userId: former.id, workspaceId: workspace.id });
    const formerPersonalAgent = await createAgent(prisma, { userId: former.id });
    return { owner, admin, member, former, channel, workspace, kb, chunkId, formerWorkspaceAgent, formerPersonalAgent };
  };
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const snapshot = async (kbId: string) => ({
    kb: await prisma.knowledgeBase.findUnique({ where: { id: kbId } }),
    chunks: await prisma.knowledgeChunk.findMany({
      where: { knowledgeBaseId: kbId },
      select: { id: true, content: true },
      orderBy: { id: "asc" },
    }),
    bases: await prisma.knowledgeBase.count(),
    attachments: await prisma.agentKnowledgeBase.count(),
  });

  const BOUNDARY = "----rx113boundary";
  const upload = {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload:
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="planted.md"\r\n` +
      `Content-Type: text/markdown\r\n\r\n# Planted\n\nby a removed admin\r\n--${BOUNDARY}--\r\n`,
  };

  describe("AC1: only the workspace owner creates a workspace knowledge base", () => {
    it.each(["admin", "member"] as const)("%s → 403, nothing created", async (actor) => {
      const ctx = await setup();
      const before = await prisma.knowledgeBase.count();

      const res = await app.inject({
        method: "POST",
        url: `/channels/${ctx.channel.id}/workspace/knowledge`,
        headers: sessionAuth(ctx[actor]),
        payload: { name: `by ${actor}` },
      });

      expect(res.statusCode).toBe(403);
      expect(await prisma.knowledgeBase.count()).toBe(before);
    });

    it("owner → 201, the base belongs to the workspace", async () => {
      const ctx = await setup();

      const res = await app.inject({
        method: "POST",
        url: `/channels/${ctx.channel.id}/workspace/knowledge`,
        headers: sessionAuth(ctx.owner),
        payload: { name: "Owner KB" },
      });

      expect(res.statusCode).toBe(201);
      expect(await prisma.knowledgeBase.findUnique({ where: { id: res.json().id } })).toMatchObject({
        workspaceId: ctx.workspace.id,
      });
    });
  });

  describe("AC2: a person removed from the workspace (member row deleted) cannot use its base through any route", () => {
    type Route = {
      method: "GET" | "POST" | "PUT" | "DELETE";
      url: (c: Ctx) => string;
      headers: (c: Ctx) => Record<string, string>;
      payload?: (c: Ctx) => unknown;
      // list-style routes answer 200 but must leave the base out
      listing?: true;
    };
    const ws = (c: Ctx) => `/channels/${c.channel.id}/workspace/knowledge`;
    const routes: [string, Route][] = [
      // personal API-key routes (/v1/knowledge)
      ["GET /v1/knowledge/bases/:id", { method: "GET", url: (c) => `/v1/knowledge/bases/${c.kb.id}`, headers: (c) => apiKey(c.former) }],
      ["PUT /v1/knowledge/bases/:id", { method: "PUT", url: (c) => `/v1/knowledge/bases/${c.kb.id}`, headers: (c) => apiKey(c.former), payload: () => ({ name: "Renamed", active: false }) }],
      ["DELETE /v1/knowledge/bases/:id", { method: "DELETE", url: (c) => `/v1/knowledge/bases/${c.kb.id}`, headers: (c) => apiKey(c.former) }],
      ["POST /v1/knowledge/bases/:id/upload", { method: "POST", url: (c) => `/v1/knowledge/bases/${c.kb.id}/upload`, headers: (c) => ({ ...apiKey(c.former), ...upload.headers }), payload: () => upload.payload }],
      ["POST /v1/knowledge/bases/:id/chunks", { method: "POST", url: (c) => `/v1/knowledge/bases/${c.kb.id}/chunks`, headers: (c) => apiKey(c.former), payload: () => ({ chunks: [{ content: "planted" }] }) }],
      ["GET /v1/knowledge/bases/:id/chunks", { method: "GET", url: (c) => `/v1/knowledge/bases/${c.kb.id}/chunks`, headers: (c) => apiKey(c.former) }],
      ["DELETE /v1/knowledge/bases/:id/chunks/:chunkId", { method: "DELETE", url: (c) => `/v1/knowledge/bases/${c.kb.id}/chunks/${c.chunkId}`, headers: (c) => apiKey(c.former) }],
      ["POST /v1/knowledge/search (this base)", { method: "POST", url: () => "/v1/knowledge/search", headers: (c) => apiKey(c.former), payload: (c) => ({ query: "secret", knowledgeBaseId: c.kb.id }) }],
      ["POST /v1/knowledge/search (all own bases)", { method: "POST", url: () => "/v1/knowledge/search", headers: (c) => apiKey(c.former), payload: () => ({ query: "secret" }), listing: true }],
      ["GET /v1/knowledge/bases (list)", { method: "GET", url: () => "/v1/knowledge/bases", headers: (c) => apiKey(c.former), listing: true }],
      // personal portal routes (/chat/portal/knowledge)
      ["GET /chat/portal/knowledge (list)", { method: "GET", url: () => "/chat/portal/knowledge", headers: (c) => portal(c.former), listing: true }],
      ["DELETE /chat/portal/knowledge/:id", { method: "DELETE", url: (c) => `/chat/portal/knowledge/${c.kb.id}`, headers: (c) => portal(c.former) }],
      ["POST /chat/portal/knowledge/:id/upload", { method: "POST", url: (c) => `/chat/portal/knowledge/${c.kb.id}/upload`, headers: (c) => ({ ...portal(c.former), ...upload.headers }), payload: () => upload.payload }],
      ["GET /chat/portal/knowledge/:id/chunks", { method: "GET", url: (c) => `/chat/portal/knowledge/${c.kb.id}/chunks`, headers: (c) => portal(c.former) }],
      ["DELETE /chat/portal/knowledge/:id/chunks/:chunkId", { method: "DELETE", url: (c) => `/chat/portal/knowledge/${c.kb.id}/chunks/${c.chunkId}`, headers: (c) => portal(c.former) }],
      // workspace routes (/channels/:channelId/workspace/knowledge)
      ["GET workspace knowledge (list)", { method: "GET", url: ws, headers: (c) => sessionAuth(c.former) }],
      ["DELETE workspace knowledge/:kbId", { method: "DELETE", url: (c) => `${ws(c)}/${c.kb.id}`, headers: (c) => sessionAuth(c.former) }],
      ["GET workspace knowledge/:kbId/chunks", { method: "GET", url: (c) => `${ws(c)}/${c.kb.id}/chunks`, headers: (c) => sessionAuth(c.former) }],
      ["POST workspace knowledge/:kbId/chunks", { method: "POST", url: (c) => `${ws(c)}/${c.kb.id}/chunks`, headers: (c) => sessionAuth(c.former), payload: () => ({ chunks: [{ content: "planted" }] }) }],
      ["DELETE workspace knowledge/:kbId/chunks/:chunkId", { method: "DELETE", url: (c) => `${ws(c)}/${c.kb.id}/chunks/${c.chunkId}`, headers: (c) => sessionAuth(c.former) }],
      ["POST workspace knowledge/search", { method: "POST", url: (c) => `${ws(c)}/search`, headers: (c) => sessionAuth(c.former), payload: () => ({ query: "secret" }) }],
      // attaching to an agent
      ["POST /agents/:id/knowledge-bases (their agent in the workspace)", { method: "POST", url: (c) => `/agents/${c.formerWorkspaceAgent.id}/knowledge-bases`, headers: (c) => sessionAuth(c.former), payload: (c) => ({ knowledgeBaseId: c.kb.id }) }],
      ["POST /agents/:id/knowledge-bases (their personal agent)", { method: "POST", url: (c) => `/agents/${c.formerPersonalAgent.id}/knowledge-bases`, headers: (c) => sessionAuth(c.former), payload: (c) => ({ knowledgeBaseId: c.kb.id }) }],
    ];

    it.each(routes)("%s → refused, nothing leaks or changes", async (_name, route) => {
      const ctx = await setup();
      const before = await snapshot(ctx.kb.id);

      const res = await app.inject({
        method: route.method,
        url: route.url(ctx),
        headers: route.headers(ctx),
        payload: route.payload?.(ctx) as string | object | undefined,
      });

      if (route.listing) {
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain(ctx.kb.id);
      } else {
        expect([403, 404]).toContain(res.statusCode);
      }
      expect(res.body).not.toContain(SECRET);
      expect(await snapshot(ctx.kb.id)).toEqual(before);
      expect(embedding.embed).not.toHaveBeenCalled();
    });
  });

  describe("AC3: a current member still reads and searches the workspace base", () => {
    it("member: list, chunks and search are 200 and return the base's content", async () => {
      const ctx = await setup();
      const base = `/channels/${ctx.channel.id}/workspace/knowledge`;

      const list = await app.inject({ method: "GET", url: base, headers: sessionAuth(ctx.member) });
      const chunks = await app.inject({ method: "GET", url: `${base}/${ctx.kb.id}/chunks`, headers: sessionAuth(ctx.member) });
      const search = await app.inject({
        method: "POST",
        url: `${base}/search`,
        headers: sessionAuth(ctx.member),
        payload: { query: "secret" },
      });

      expect([list.statusCode, chunks.statusCode, search.statusCode]).toEqual([200, 200, 200]);
      expect(list.json().map((k: { id: string }) => k.id)).toEqual([ctx.kb.id]);
      expect(chunks.json().chunks).toEqual([expect.objectContaining({ content: SECRET })]);
      expect(search.json()).toEqual([expect.objectContaining({ content: SECRET, knowledge_base_id: ctx.kb.id })]);
      expect(embedding.embedSingle).toHaveBeenCalledWith("secret");
    });
  });

  describe("attaching a knowledge base to an agent", () => {
    const attach = (agentId: string, knowledgeBaseId: string, user: { id: string; email: string }) =>
      app.inject({
        method: "POST",
        url: `/agents/${agentId}/knowledge-bases`,
        headers: sessionAuth(user),
        payload: { knowledgeBaseId },
      });

    it("the owner attaches the workspace base to an agent in that workspace (201)", async () => {
      const ctx = await setup();
      const agent = await createAgent(prisma, { userId: ctx.owner.id, workspaceId: ctx.workspace.id });

      const res = await attach(agent.id, ctx.kb.id, ctx.owner);

      expect(res.statusCode).toBe(201);
      expect(await prisma.agentKnowledgeBase.count({ where: { agentId: agent.id, knowledgeBaseId: ctx.kb.id } })).toBe(1);
    });

    // RNX-203: an agent belongs to its workspace's owner; an admin or member who created it there no longer reaches it
    // (RX-113 answered 201 for an admin and 403 for a member). RNX-260 (D259): a collaborator inside the workspace gets
    // 403 on an agent write (was 404); 404 is for people outside it.
    it.each(["admin", "member"] as const)("a current %s cannot attach the workspace base to an agent they created there (403)", async (actor) => {
      const ctx = await setup();
      const agent = await createAgent(prisma, { userId: ctx[actor].id, workspaceId: ctx.workspace.id });

      const res = await attach(agent.id, ctx.kb.id, ctx[actor]);

      expect(res.statusCode).toBe(403);
      expect(await prisma.agentKnowledgeBase.count()).toBe(0);
    });

    it("the owner cannot attach the workspace base to an agent outside that workspace (404)", async () => {
      const ctx = await setup();
      const personal = await createAgent(prisma, { userId: ctx.owner.id });
      const otherWorkspace = await createWorkspace(prisma, { ownerId: ctx.owner.id });
      const elsewhere = await createAgent(prisma, { userId: ctx.owner.id, workspaceId: otherWorkspace.id });

      const toPersonal = await attach(personal.id, ctx.kb.id, ctx.owner);
      const toElsewhere = await attach(elsewhere.id, ctx.kb.id, ctx.owner);

      expect([toPersonal.statusCode, toElsewhere.statusCode]).toEqual([404, 404]);
      expect(await prisma.agentKnowledgeBase.count()).toBe(0);
    });

    it("a personal base attaches only to its owner's agents (201 own, 404 for someone else's base)", async () => {
      const ctx = await setup();
      const ownerKb = await prisma.knowledgeBase.create({ data: { userId: ctx.owner.id, name: "Owner personal" } });
      const memberKb = await prisma.knowledgeBase.create({ data: { userId: ctx.member.id, name: "Member personal" } });
      const agent = await createAgent(prisma, { userId: ctx.owner.id });

      const own = await attach(agent.id, ownerKb.id, ctx.owner);
      const foreign = await attach(agent.id, memberKb.id, ctx.owner);

      expect([own.statusCode, foreign.statusCode]).toEqual([201, 404]);
      expect(await prisma.agentKnowledgeBase.findMany({ select: { knowledgeBaseId: true } })).toEqual([
        { knowledgeBaseId: ownerKb.id },
      ]);
    });
  });

  describe("RNX-145: a deleted knowledge base", () => {
    const PERSONAL = "personal note of the owner";

    /**
     * The RX-113 setup, plus the owner's personal base (one chunk) linked to the owner's personal agent, and the
     * workspace base linked to the owner's agent in the workspace, which is also in the workspace channel.
     */
    const seed = async () => {
      const ctx = await setup();
      const personal = await prisma.knowledgeBase.create({ data: { userId: ctx.owner.id, name: "Owner personal" } });
      await insertChunk(personal.id, PERSONAL);
      const personalAgent = await createAgent(prisma, { userId: ctx.owner.id });
      const workspaceAgent = await createAgent(prisma, { userId: ctx.owner.id, workspaceId: ctx.workspace.id });
      await prisma.agentKnowledgeBase.createMany({
        data: [
          { agentId: personalAgent.id, knowledgeBaseId: personal.id },
          { agentId: workspaceAgent.id, knowledgeBaseId: ctx.kb.id },
        ],
      });
      await prisma.channelAgent.create({ data: { channelId: ctx.channel.id, agentId: workspaceAgent.id } });
      return { ...ctx, personal, personalAgent, workspaceAgent };
    };
    type Seeded = Awaited<ReturnType<typeof seed>>;

    /** Every row a knowledge base route could change, read as they are (deleted ones included). */
    const readRows = async () => ({
      bases: await all.knowledgeBase.findMany({ orderBy: { id: "asc" } }),
      chunks: await all.knowledgeChunk.findMany({ orderBy: { id: "asc" }, select: { id: true, knowledgeBaseId: true, content: true } }),
      links: await all.agentKnowledgeBase.findMany({ orderBy: { id: "asc" } }),
    });
    const mark = (id: string, userId: string) =>
      all.knowledgeBase.updateMany({ where: { id }, data: { deletedAt: new Date(), deletedById: userId } });
    const clear = (id: string) => all.knowledgeBase.updateMany({ where: { id }, data: { deletedAt: null, deletedById: null } });
    const ws = (c: Seeded) => `/channels/${c.channel.id}/workspace/knowledge`;
    const contents = (body: Array<{ content: string }>) => body.map((r) => r.content);

    it.each([
      ["DELETE /v1/knowledge/bases/:id (API key)", (c: Seeded) => ({ url: `/v1/knowledge/bases/${c.personal.id}`, headers: apiKey(c.owner) })],
      ["DELETE /chat/portal/knowledge/:id (portal)", (c: Seeded) => ({ url: `/chat/portal/knowledge/${c.personal.id}`, headers: portal(c.owner) })],
    ])("RNX-145 AC1: %s answers 204 with no body as before; the row gets deletedAt and deletedById, its chunks and agent link stay", async (_name, route) => {
      const ctx = await seed();
      const before = await readRows();

      const res = await app.inject({ method: "DELETE", ...route(ctx) });

      expect([res.statusCode, res.body]).toEqual([204, ""]);
      const after = await readRows();
      expect(after.bases.find((b) => b.id === ctx.personal.id)).toEqual({
        ...before.bases.find((b) => b.id === ctx.personal.id),
        deletedAt: expect.any(Date),
        deletedById: ctx.owner.id,
        updatedAt: expect.any(Date),
      });
      expect(after.bases.filter((b) => b.id !== ctx.personal.id)).toEqual(before.bases.filter((b) => b.id !== ctx.personal.id));
      expect({ ...after, bases: [] }).toEqual({ ...before, bases: [] });
    });

    it("RNX-145 AC1: the workspace owner's DELETE of a workspace base answers 200 { deleted: true } as before; the row gets the marker, its chunks and agent link stay", async () => {
      const ctx = await seed();
      const before = await readRows();

      const res = await app.inject({ method: "DELETE", url: `${ws(ctx)}/${ctx.kb.id}`, headers: sessionAuth(ctx.owner) });

      expect([res.statusCode, res.json()]).toEqual([200, { deleted: true }]);
      const after = await readRows();
      expect(after.bases.find((b) => b.id === ctx.kb.id)).toEqual({
        ...before.bases.find((b) => b.id === ctx.kb.id),
        deletedAt: expect.any(Date),
        deletedById: ctx.owner.id,
        updatedAt: expect.any(Date),
      });
      expect({ ...after, bases: [] }).toEqual({ ...before, bases: [] });
    });

    it("RNX-145 AC2, AC6: a deleted personal base is not listed (API key and portal lists and their count), and read, update, delete, its chunks, upload and search by id answer 404 and change nothing; back once the marker is cleared", async () => {
      const ctx = await seed();
      await mark(ctx.personal.id, ctx.owner.id);
      const before = await readRows();
      const base = `/v1/knowledge/bases/${ctx.personal.id}`;
      const routes = [
        { method: "GET", url: base },
        { method: "PUT", url: base, payload: { name: "Renamed" } },
        { method: "DELETE", url: base },
        { method: "GET", url: `${base}/chunks` },
        { method: "POST", url: `${base}/chunks`, payload: { chunks: [{ content: "planted" }] } },
        { method: "POST", url: `${base}/upload`, headers: upload.headers, payload: upload.payload },
        { method: "POST", url: "/v1/knowledge/search", payload: { query: "note", knowledgeBaseId: ctx.personal.id } },
      ] as const;

      const list = await app.inject({ method: "GET", url: "/v1/knowledge/bases", headers: apiKey(ctx.owner) });
      const portalList = await app.inject({ method: "GET", url: "/chat/portal/knowledge", headers: portal(ctx.owner) });
      const statuses = [];
      for (const r of routes) {
        const res = await app.inject({ method: r.method, url: r.url, headers: { ...apiKey(ctx.owner), ...("headers" in r ? r.headers : {}) }, payload: "payload" in r ? r.payload : undefined });
        statuses.push(res.statusCode);
        expect(res.body).not.toContain(PERSONAL);
      }

      expect([list.json(), portalList.json()]).toEqual([[], []]);
      expect(statuses).toEqual(routes.map(() => 404));
      expect(await readRows()).toEqual(before);
      expect(embedding.embed).not.toHaveBeenCalled();
      await clear(ctx.personal.id);
      const listBack = await app.inject({ method: "GET", url: "/v1/knowledge/bases", headers: apiKey(ctx.owner) });
      const readBack = await app.inject({ method: "GET", url: base, headers: apiKey(ctx.owner) });
      expect(listBack.json().map((b: { id: string }) => b.id)).toEqual([ctx.personal.id]);
      expect(readBack.statusCode).toBe(200);
    });

    it("RNX-145 AC2, AC6: a deleted workspace base is not in the workspace list (nor its count); its chunks, adding chunks and deleting it again answer 404 and change nothing; back once the marker is cleared", async () => {
      const ctx = await seed();
      await mark(ctx.kb.id, ctx.owner.id);
      const before = await readRows();

      const list = await app.inject({ method: "GET", url: ws(ctx), headers: sessionAuth(ctx.member) });
      const chunks = await app.inject({ method: "GET", url: `${ws(ctx)}/${ctx.kb.id}/chunks`, headers: sessionAuth(ctx.member) });
      const add = await app.inject({ method: "POST", url: `${ws(ctx)}/${ctx.kb.id}/chunks`, headers: sessionAuth(ctx.member), payload: { chunks: [{ content: "planted" }] } });
      const again = await app.inject({ method: "DELETE", url: `${ws(ctx)}/${ctx.kb.id}`, headers: sessionAuth(ctx.owner) });

      expect(list.json()).toEqual([]);
      expect([chunks.statusCode, add.statusCode, again.statusCode]).toEqual([404, 404, 404]);
      expect(chunks.body).not.toContain(SECRET);
      expect(await readRows()).toEqual(before);
      await clear(ctx.kb.id);
      const listBack = await app.inject({ method: "GET", url: ws(ctx), headers: sessionAuth(ctx.member) });
      expect(listBack.json().map((b: { id: string }) => b.id)).toEqual([ctx.kb.id]);
    });

    it("RNX-145 AC3: a deleted base still linked to a live agent gives no chunk to the personal search (API key), or to the workspace search; both find it again once the marker is cleared", async () => {
      const ctx = await seed();
      await mark(ctx.personal.id, ctx.owner.id);
      await mark(ctx.kb.id, ctx.owner.id);
      const searchAll = () => app.inject({ method: "POST", url: "/v1/knowledge/search", headers: apiKey(ctx.owner), payload: { query: "note" } });
      const searchWorkspace = () => app.inject({ method: "POST", url: `${ws(ctx)}/search`, headers: sessionAuth(ctx.member), payload: { query: "secret" } });

      const personalHidden = await searchAll();
      const workspaceHidden = await searchWorkspace();
      await clear(ctx.personal.id);
      await clear(ctx.kb.id);
      const personalShown = await searchAll();
      const workspaceShown = await searchWorkspace();

      expect([personalHidden.statusCode, workspaceHidden.statusCode]).toEqual([200, 200]);
      expect([personalHidden.json(), workspaceHidden.json()]).toEqual([[], []]);
      expect(contents(personalShown.json())).toEqual([PERSONAL]);
      expect(contents(workspaceShown.json())).toEqual([SECRET]);
    });

    it("RNX-145 AC3: the vector search of one base (the agent run's and the by-id search's raw SQL) returns no chunk of a deleted base; again once the marker is cleared", async () => {
      const ctx = await seed();
      const chunks = moduleRef.get(KnowledgeChunkRepository);
      const search = () => chunks.searchChunksInKnowledgeBase(ctx.personal.id, unit(), embedding.modelName, 5);
      await mark(ctx.personal.id, ctx.owner.id);

      const hidden = await search();
      await clear(ctx.personal.id);
      const shown = await search();

      expect(hidden).toEqual([]);
      expect(contents(shown)).toEqual([PERSONAL]);
    });

    it("RNX-145 AC5, D99: the agent's knowledge base list (GET /agents/:id and GET /agents) leaves the deleted base's link out, and unlinking it answers 404; the link row stays and is shown again once the marker is cleared", async () => {
      const ctx = await seed();
      const linkIds = (agent: { knowledgeBases: Array<{ knowledgeBaseId: string }> }) => agent.knowledgeBases.map((k) => k.knowledgeBaseId);
      const read = async () => (await app.inject({ method: "GET", url: `/agents/${ctx.personalAgent.id}`, headers: sessionAuth(ctx.owner) })).json();
      const list = async () =>
        (await app.inject({ method: "GET", url: "/agents", headers: sessionAuth(ctx.owner) })).json().find((a: { id: string }) => a.id === ctx.personalAgent.id);
      await mark(ctx.personal.id, ctx.owner.id);
      const before = await readRows();

      const hidden = [linkIds(await read()), linkIds(await list())];
      const unlink = await app.inject({ method: "DELETE", url: `/agents/${ctx.personalAgent.id}/knowledge-bases/${ctx.personal.id}`, headers: sessionAuth(ctx.owner) });

      expect(hidden).toEqual([[], []]);
      expect(unlink.statusCode).toBe(404);
      expect(await readRows()).toEqual(before);
      await clear(ctx.personal.id);
      expect([linkIds(await read()), linkIds(await list())]).toEqual([[ctx.personal.id], [ctx.personal.id]]);
    });

    it("RNX-145 AC5, D99: the run lookups leave a deleted base's link out: the agent of a run, its relations, its channel link and its WhatsApp channel; again once the marker is cleared", async () => {
      const ctx = await seed();
      await prisma.agentChannel.create({ data: { agentId: ctx.workspaceAgent.id, channelType: "whatsapp", config: { phoneNumber: "+620000145" } } });
      const agents = moduleRef.get(AgentRepository);
      const lookups = async () => ({
        forRun: (await agents.findAgentForRun(ctx.workspaceAgent.id))?.knowledgeBases.map((k) => k.knowledgeBaseId),
        withRelations: (await agents.findAgentWithRelations(ctx.workspaceAgent.id))?.knowledgeBases.map((k) => k.knowledgeBaseId),
        channelLink: (await moduleRef.get(ChannelAgentRepository).findChannelAgentWithAgent(ctx.channel.id, ctx.workspaceAgent.id))?.agent.knowledgeBases.map((k) => k.knowledgeBaseId),
        whatsapp: (await moduleRef.get(AgentChannelRepository).findActiveWhatsappChannels("+620000145")).map((c) => c.agent.knowledgeBases.map((k) => k.knowledgeBaseId)),
      });
      await mark(ctx.kb.id, ctx.owner.id);

      const hidden = await lookups();
      await clear(ctx.kb.id);
      const shown = await lookups();

      expect(hidden).toEqual({ forRun: [], withRelations: [], channelLink: [], whatsapp: [[]] });
      expect(shown).toEqual({ forRun: [ctx.kb.id], withRelations: [ctx.kb.id], channelLink: [ctx.kb.id], whatsapp: [[ctx.kb.id]] });
    });

    it.each(["admin", "member"] as const)("RNX-145 AC7: a workspace %s deleting the workspace base gets 403 as before; nothing changes", async (actor) => {
      const ctx = await seed();
      const before = await readRows();

      const res = await app.inject({ method: "DELETE", url: `${ws(ctx)}/${ctx.kb.id}`, headers: sessionAuth(ctx[actor]) });

      expect(res.statusCode).toBe(403);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-145 AC8: another workspace's base through the caller's own workspace route answers 404; another user's personal base answers 403 as before (RX-15); nothing is marked", async () => {
      const ctx = await seed();
      const otherChannel = await prisma.channel.create({ data: { userId: ctx.admin.id, name: "Admin's" } });
      const other = await createWorkspace(prisma, { ownerId: ctx.admin.id, channelId: otherChannel.id });
      await prisma.workspaceMember.create({ data: { workspaceId: other.id, userId: ctx.admin.id, role: "owner", status: "active" } });
      const before = await readRows();

      const viaOwnWorkspace = await app.inject({ method: "DELETE", url: `/channels/${otherChannel.id}/workspace/knowledge/${ctx.kb.id}`, headers: sessionAuth(ctx.admin) });
      const personal = await app.inject({ method: "DELETE", url: `/v1/knowledge/bases/${ctx.personal.id}`, headers: apiKey(ctx.member) });

      expect([viaOwnWorkspace.statusCode, personal.statusCode]).toEqual([404, 403]);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-145 AC13: a base of a deleted workspace (RNX-125) stays hidden: the workspace list and search answer 404, the personal search has no chunk of it and searching it by id is 404", async () => {
      const ctx = await seed();
      await all.workspace.updateMany({ where: { id: ctx.workspace.id }, data: { deletedAt: new Date(), deletedById: ctx.owner.id } });

      const list = await app.inject({ method: "GET", url: ws(ctx), headers: sessionAuth(ctx.owner) });
      const search = await app.inject({ method: "POST", url: `${ws(ctx)}/search`, headers: sessionAuth(ctx.owner), payload: { query: "secret" } });
      const personalSearch = await app.inject({ method: "POST", url: "/v1/knowledge/search", headers: apiKey(ctx.owner), payload: { query: "secret" } });
      const byId = await app.inject({ method: "POST", url: "/v1/knowledge/search", headers: apiKey(ctx.owner), payload: { query: "secret", knowledgeBaseId: ctx.kb.id } });

      expect([list.statusCode, search.statusCode, byId.statusCode]).toEqual([404, 404, 404]);
      expect(contents(personalSearch.json())).toEqual([PERSONAL]);
      for (const res of [list, search, personalSearch, byId]) expect(res.body).not.toContain(SECRET);
    });

    it("RNX-145: the writes by id name deletedAt: null: a second soft delete and an update of a deleted base answer 404 and change nothing", async () => {
      const ctx = await seed();
      const bases = moduleRef.get(KnowledgeBaseRepository);
      await bases.softDeleteKnowledgeBase(ctx.personal.id, ctx.owner.id);
      const before = await readRows();

      await expect(bases.softDeleteKnowledgeBase(ctx.personal.id, ctx.member.id)).rejects.toMatchObject({ status: 404 });
      await expect(bases.updateKnowledgeBase(ctx.personal.id, { name: "Renamed" })).rejects.toMatchObject({ status: 404 });

      expect(await readRows()).toEqual(before);
    });
  });
});
