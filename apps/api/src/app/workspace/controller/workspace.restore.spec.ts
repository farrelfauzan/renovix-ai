import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceInviteController } from "./workspace-invite.controller";
import { WorkspaceChannelController } from "./workspace-channel.controller";
import { WorkspaceService } from "../service/workspace.service";
import { WorkspaceMemberService } from "../service/workspace-member.service";
import { WorkspaceInviteService } from "../service/workspace-invite.service";
import { WorkspaceQuotaService } from "../service/workspace-quota.service";
import { WorkspaceKnowledgeService } from "../service/workspace-knowledge.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { hashToken } from "../utils/hash-token";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-126: GET /workspaces/deleted and POST /workspaces/:id/restore (the owner only), and the workspace knowledge base
// routes GET /channels/:channelId/workspace/knowledge/deleted and POST .../knowledge/:kbId/restore (the workspace owner
// only, D64, as their DELETE). A restored workspace brings back everything hidden with it; a child deleted on its own
// before the workspace stays deleted. Real controllers and services, test database; email sending, embeddings and S3
// are stubs; AgentMemoryService is real (the memory put into a model's prompt). `all` is a client with nothing on
// PrismaService's default filter map, to read the rows as they are. The agents of a restored workspace run again and
// D316 are in agent.restore.spec.ts.
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));
jest.mock("../../knowledge/service/embedding.service", () => ({ EmbeddingService: class {} }));
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));

type User = { id: string; email: string };

/** An Enterprise owner's workspace with its channel and child rows; Bob a member, Dave an admin, Carol invited. */
async function seedWorkspace(prisma: PrismaService) {
  const owner = await createUser(prisma);
  const bob = await createUser(prisma);
  const dave = await createUser(prisma);
  const carol = await createUser(prisma);
  await createPackageSnapshot(prisma, { userId: owner.id, collaborationEnabled: true });
  const channel = await prisma.channel.create({ data: { userId: owner.id, name: "Team" } });
  const workspace = await createWorkspace(prisma, { ownerId: owner.id, name: "Team", channelId: channel.id });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: owner.id, role: "owner" } });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: bob.id, role: "member" } });
  await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: dave.id, role: "admin" } });
  await prisma.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      email: carol.email,
      emailNormalized: carol.email,
      tokenHash: hashToken(`rnx126-carol-${workspace.id}`),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedById: owner.id,
    },
  });
  const kb = await prisma.knowledgeBase.create({ data: { userId: owner.id, workspaceId: workspace.id, name: "Team KB" } });
  const chunk = await prisma.knowledgeChunk.create({
    data: { knowledgeBaseId: kb.id, content: "team secret", tokenCount: 2, embeddingModel: "test-model", embeddedAt: new Date() },
  });
  await prisma.workspaceMemory.create({ data: { workspaceId: workspace.id, type: "fact", content: "team fact" } });
  const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id });
  return { owner, bob, dave, carol, channel, workspace, kb, chunk, agent };
}

describe("RNX-126: the owner lists and restores deleted workspaces and workspace knowledge bases (Fastify, test database)", () => {
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
      controllers: [WorkspaceController, WorkspaceInviteController, WorkspaceChannelController],
      providers: [
        WorkspaceService,
        WorkspaceMemberService,
        WorkspaceInviteService,
        WorkspaceQuotaService,
        WorkspaceKnowledgeService,
        AgentMemoryService,
        { provide: AgentRunMeterService, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
        { provide: EmailJobService, useValue: { enqueue: async () => undefined } },
        { provide: EmbeddingService, useValue: embedding },
        { provide: S3Service, useValue: {} },
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

  const call = (method: "GET" | "POST" | "DELETE", url: string, user: User, payload?: object) =>
    app.inject({ method, url, headers: asSessionUser(user), payload });
  const ids = async (url: string, user: User) => (await call("GET", url, user)).json().map((row: { id: string }) => row.id);
  /** Every row a restore could change, read as they are (deleted ones included). */
  const readRows = async () => ({
    workspaces: await all.workspace.findMany({ orderBy: { id: "asc" } }),
    members: await all.workspaceMember.findMany({ orderBy: { id: "asc" } }),
    invites: await all.workspaceInvite.findMany({ orderBy: { id: "asc" } }),
    memories: await all.workspaceMemory.findMany({ orderBy: { id: "asc" } }),
    knowledgeBases: await all.knowledgeBase.findMany({ orderBy: { id: "asc" } }),
    agents: await all.agent.findMany({ orderBy: { id: "asc" } }),
  });

  describe("workspaces", () => {
    it("RNX-126: the list gives id, name, deletedAt and purgeAt = deletedAt + 30 days, newest-deleted first", async () => {
      const s = await seedWorkspace(prisma);
      const older = await createWorkspace(prisma, { ownerId: s.owner.id, name: "Older" });
      await createWorkspace(prisma, { ownerId: s.owner.id, name: "Live" });
      await all.workspace.update({ where: { id: older.id }, data: { deletedAt: new Date("2026-10-20T00:00:00.000Z"), deletedById: s.owner.id } });
      await all.workspace.update({ where: { id: s.workspace.id }, data: { deletedAt: new Date("2026-11-02T12:00:00.000Z"), deletedById: s.owner.id } });

      const res = await call("GET", "/workspaces/deleted", s.owner);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { id: s.workspace.id, name: "Team", deletedAt: "2026-11-02T12:00:00.000Z", purgeAt: "2026-12-02T12:00:00.000Z" },
        { id: older.id, name: "Older", deletedAt: "2026-10-20T00:00:00.000Z", purgeAt: "2026-11-19T00:00:00.000Z" },
      ]);
    });

    it("RNX-126 AC1, AC8: after restore the workspace is listed and readable, its members have access again, its knowledge base is listed and searchable, its memory is in a model's context, the invite can be accepted; a knowledge base and an agent deleted on their own before stay deleted", async () => {
      const s = await seedWorkspace(prisma);
      const ownKb = await prisma.knowledgeBase.create({ data: { userId: s.owner.id, workspaceId: s.workspace.id, name: "Own KB" } });
      const ownAgent = await createAgent(prisma, { userId: s.owner.id, workspaceId: s.workspace.id });
      expect((await call("DELETE", `/channels/${s.channel.id}/workspace/knowledge/${ownKb.id}`, s.owner)).statusCode).toBe(200);
      await all.agent.update({ where: { id: ownAgent.id }, data: { deletedAt: new Date(), deletedById: s.owner.id } });
      expect((await call("DELETE", `/workspaces/${s.workspace.id}`, s.owner)).statusCode).toBe(200);
      const memory = moduleRef.get(AgentMemoryService);
      expect(await memory.getWorkspaceMemoryContext(s.agent.id, "inside")).toBe("");
      expect(await ids("/workspaces/deleted", s.owner)).toEqual([s.workspace.id]);

      const res = await call("POST", `/workspaces/${s.workspace.id}/restore`, s.owner);

      expect([res.statusCode, res.json()]).toEqual([200, { id: s.workspace.id, name: "Team" }]);
      expect(await ids("/workspaces/deleted", s.owner)).toEqual([]);
      expect(await ids("/workspaces", s.owner)).toEqual([s.workspace.id]);
      expect(await ids("/workspaces", s.bob)).toEqual([s.workspace.id]);
      expect((await call("GET", `/workspaces/${s.workspace.id}`, s.bob)).statusCode).toBe(200);
      expect(await ids(`/channels/${s.channel.id}/workspace/knowledge`, s.bob)).toEqual([s.kb.id]);
      const search = await call("POST", `/channels/${s.channel.id}/workspace/knowledge/search`, s.bob, { query: "secret" });
      expect(search.json().map((row: { id: string }) => row.id)).toEqual([s.chunk.id]);
      expect(await memory.getWorkspaceMemoryContext(s.agent.id, "inside")).toBe("- [fact] team fact");
      expect((await call("POST", "/workspace-invites/accept", s.carol, { token: `rnx126-carol-${s.workspace.id}` })).statusCode).toBe(200);
      expect(await all.knowledgeBase.findUniqueOrThrow({ where: { id: ownKb.id } })).toMatchObject({ deletedAt: expect.any(Date) });
      expect(await all.agent.findUniqueOrThrow({ where: { id: ownAgent.id } })).toMatchObject({ deletedAt: expect.any(Date) });
      expect(await ids(`/channels/${s.channel.id}/workspace/knowledge/deleted`, s.owner)).toEqual([ownKb.id]);
    });

    it.each([
      ["a member who is not the owner (AC9)", (s: Awaited<ReturnType<typeof seedWorkspace>>) => s.bob],
      ["another user (AC2)", (s: Awaited<ReturnType<typeof seedWorkspace>>) => s.carol],
    ])("RNX-126: %s does not see the deleted workspace listed and its restore answers 404; nothing changes", async (_who, pick) => {
      const s = await seedWorkspace(prisma);
      expect((await call("DELETE", `/workspaces/${s.workspace.id}`, s.owner)).statusCode).toBe(200);
      const before = await readRows();

      const listed = await ids("/workspaces/deleted", pick(s));
      const res = await call("POST", `/workspaces/${s.workspace.id}/restore`, pick(s));

      expect(listed).toEqual([]);
      expect([res.statusCode, res.json().message]).toEqual([404, "Workspace not found"]);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-126 AC3: restore on a live workspace answers 404; nothing changes", async () => {
      const s = await seedWorkspace(prisma);
      const before = await readRows();

      const res = await call("POST", `/workspaces/${s.workspace.id}/restore`, s.owner);

      expect([res.statusCode, res.json().message]).toEqual([404, "Workspace not found"]);
      expect(await readRows()).toEqual(before);
    });
  });

  describe("workspace knowledge bases", () => {
    const kbUrl = (s: { channel: { id: string } }, path = "") => `/channels/${s.channel.id}/workspace/knowledge${path}`;

    it("RNX-126 AC1: the owner lists the deleted knowledge base with its purgeAt; after restore it is listed again with its chunks and searchable", async () => {
      const s = await seedWorkspace(prisma);
      await all.knowledgeBase.update({ where: { id: s.kb.id }, data: { deletedAt: new Date("2026-11-03T09:00:00.000Z"), deletedById: s.owner.id } });
      expect((await call("GET", kbUrl(s, "/deleted"), s.owner)).json()).toEqual([
        { id: s.kb.id, name: "Team KB", deletedAt: "2026-11-03T09:00:00.000Z", purgeAt: "2026-12-03T09:00:00.000Z" },
      ]);

      const res = await call("POST", kbUrl(s, `/${s.kb.id}/restore`), s.owner);

      expect([res.statusCode, res.json()]).toEqual([200, { id: s.kb.id, name: "Team KB" }]);
      expect(await ids(kbUrl(s, "/deleted"), s.owner)).toEqual([]);
      expect(await ids(kbUrl(s), s.owner)).toEqual([s.kb.id]);
      expect((await call("GET", kbUrl(s, `/${s.kb.id}/chunks`), s.owner)).json().chunks.map((c: { id: string }) => c.id)).toEqual([s.chunk.id]);
      const search = await call("POST", kbUrl(s, "/search"), s.owner, { query: "secret" });
      expect(search.json().map((row: { id: string }) => row.id)).toEqual([s.chunk.id]);
    });

    it.each([
      ["a member", (s: Awaited<ReturnType<typeof seedWorkspace>>) => s.bob],
      ["an admin", (s: Awaited<ReturnType<typeof seedWorkspace>>) => s.dave],
    ])("RNX-126 AC5: %s gets 403 on the list and the restore; nothing changes", async (_who, pick) => {
      const s = await seedWorkspace(prisma);
      expect((await call("DELETE", kbUrl(s, `/${s.kb.id}`), s.owner)).statusCode).toBe(200);
      const before = await readRows();

      const listed = await call("GET", kbUrl(s, "/deleted"), pick(s));
      const res = await call("POST", kbUrl(s, `/${s.kb.id}/restore`), pick(s));

      expect([listed.statusCode, res.statusCode]).toEqual([403, 403]);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-126 AC2: another workspace's deleted knowledge base is not listed and its restore through this workspace answers 404; nothing changes", async () => {
      const s = await seedWorkspace(prisma);
      const other = await seedWorkspace(prisma);
      await all.knowledgeBase.update({ where: { id: other.kb.id }, data: { deletedAt: new Date(), deletedById: other.owner.id } });
      const before = await readRows();

      const listed = await ids(kbUrl(s, "/deleted"), s.owner);
      const res = await call("POST", kbUrl(s, `/${other.kb.id}/restore`), s.owner);

      expect(listed).toEqual([]);
      expect([res.statusCode, res.json().message]).toEqual([404, "Knowledge base not found"]);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-126 AC3: restore on a live knowledge base answers 404; nothing changes", async () => {
      const s = await seedWorkspace(prisma);
      const before = await readRows();

      const res = await call("POST", kbUrl(s, `/${s.kb.id}/restore`), s.owner);

      expect([res.statusCode, res.json().message]).toEqual([404, "Knowledge base not found"]);
      expect(await readRows()).toEqual(before);
    });

    it("RNX-126 (c): a knowledge base of a deleted workspace is not listed (404) and its restore answers 404; restorable once the workspace is restored", async () => {
      const s = await seedWorkspace(prisma);
      expect((await call("DELETE", kbUrl(s, `/${s.kb.id}`), s.owner)).statusCode).toBe(200);
      expect((await call("DELETE", `/workspaces/${s.workspace.id}`, s.owner)).statusCode).toBe(200);
      const before = await readRows();

      const listed = await call("GET", kbUrl(s, "/deleted"), s.owner);
      const res = await call("POST", kbUrl(s, `/${s.kb.id}/restore`), s.owner);

      expect([listed.statusCode, listed.json().message]).toEqual([404, "Workspace not found"]);
      expect([res.statusCode, res.json().message]).toEqual([404, "Workspace not found"]);
      expect(await readRows()).toEqual(before);
      expect((await call("POST", `/workspaces/${s.workspace.id}/restore`, s.owner)).statusCode).toBe(200);
      expect(await ids(kbUrl(s, "/deleted"), s.owner)).toEqual([s.kb.id]);
      expect((await call("POST", kbUrl(s, `/${s.kb.id}/restore`), s.owner)).statusCode).toBe(200);
    });
  });
});
