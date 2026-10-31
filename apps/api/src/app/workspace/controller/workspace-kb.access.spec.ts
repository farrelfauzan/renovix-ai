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
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  createAgent,
  createApiKey,
  createPackageSnapshot,
  createPlan,
  createSubscription,
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
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    embedding.embed.mockClear();
  });

  afterAll(() => app?.close());

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
    const enterprise = await createPlan(prisma, { slug: "enterprise", maxWorkspaceUsers: 100 });
    const owner = await fundedUser();
    const admin = await fundedUser();
    const member = await fundedUser();
    const former = await fundedUser();
    await createSubscription(prisma, { userId: owner.id, planId: enterprise.id });
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
});
