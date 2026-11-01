import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentController } from "./agent.controller";
import { AgentLinkController } from "./agent-link.controller";
import { AgentService } from "../service/agent.service";
import { AgentLinkService } from "../service/agent-link.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { AgentIntegrationRepository } from "../repository/agent-integration.repository";
import { AgentRepository } from "../repository/agent.repository";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";
import { cheapestTierRegistry } from "../../../../test/cheapest-tier-registry";

// RNX-124: DELETE /agents/:id marks the agent (deletedAt, deletedById) and keeps the row and its child rows, except its
// integrations, which are erased in the same transaction (decision 25). Every agent route then answers as for an
// agent that does not exist, the public list and the clone route do not see it, a live agent's links and its
// workspace's agent count leave it out, the plan quota does not count it, and its slug can be used again. Real
// controllers and services, test database. No route used here calls a model.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

describe("RNX-124: a deleted agent is hidden, not destroyed (agent routes, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController, AgentLinkController],
      providers: [
        AgentService,
        AgentLinkService,
        EntitlementService,
        AgentRunPolicyService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: cheapestTierRegistry },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  /**
   * The owner's workspace with agent A (public, active) and live agents B and C; A has a tool, an integration, a
   * knowledge base, a deployed channel, a run of the owner, a link A -> B and a link C -> A.
   */
  const seed = async () => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id, maxAgents: 5, maxConnectedTools: 5 });
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "owner", status: "active", joinedAt: new Date() },
    });
    const a = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: "Agent A", status: "active", isPublic: true });
    const b = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: "Agent B" });
    const c = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: "Agent C" });
    const tool = await prisma.agentTool.create({ data: { agentId: a.id, toolType: "calculator" } });
    const integration = await prisma.agentIntegration.create({
      data: { agentId: a.id, provider: "jira", config: { baseUrl: "http://jira.invalid" }, scopes: ["read"] },
    });
    const kb = await prisma.knowledgeBase.create({ data: { userId: owner.id, workspaceId: workspace.id, name: "KB" } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: a.id, knowledgeBaseId: kb.id } });
    const channel = await prisma.agentChannel.create({ data: { agentId: a.id, channelType: "api", status: "active" } });
    await prisma.agentRun.create({ data: { agentId: a.id, userId: owner.id, sessionId: "s-1", channelType: "web" } });
    await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: b.id } });
    await prisma.agentLink.create({ data: { callerAgentId: c.id, calleeAgentId: a.id } });
    return { owner, session: asSessionUser(owner), workspace, a, b, c, tool, integration, kb, channel };
  };
  type Seeded = Awaited<ReturnType<typeof seed>>;

  const deleteAgent = (agentId: string, session: { cookie: string }) =>
    app.inject({ method: "DELETE", url: `/agents/${agentId}`, headers: session });

  /** The agent row as stored, read on purpose including a deleted one (the caller's condition on deletedAt wins). */
  const storedAgent = (agentId: string) =>
    prisma.agent.findFirst({ where: { id: agentId, deletedAt: { not: null } }, select: { deletedAt: true, deletedById: true } });

  /** The child rows of an agent, read from the child tables. */
  const children = async (agentId: string) => ({
    tools: await prisma.agentTool.count({ where: { agentId } }),
    integrations: await prisma.agentIntegration.count({ where: { agentId } }),
    knowledge: await prisma.agentKnowledgeBase.count({ where: { agentId } }),
    channels: await prisma.agentChannel.count({ where: { agentId } }),
    runs: await prisma.agentRun.count({ where: { agentId } }),
    linksAsCaller: await prisma.agentLink.count({ where: { callerAgentId: agentId } }),
    linksAsCallee: await prisma.agentLink.count({ where: { calleeAgentId: agentId } }),
  });

  it("RNX-124 AC1, AC8: the owner deletes A → 204; the row stays with deletedAt and deletedById, its child rows stay, its integrations are erased", async () => {
    const { owner, session, a } = await seed();

    const res = await deleteAgent(a.id, session);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(await storedAgent(a.id)).toEqual({ deletedAt: expect.any(Date), deletedById: owner.id });
    expect(await children(a.id)).toEqual({
      tools: 1,
      integrations: 0,
      knowledge: 1,
      channels: 1,
      runs: 1,
      linksAsCaller: 1,
      linksAsCallee: 1,
    });
  });

  it("RNX-124 AC8: the marker and the integration erase are one transaction (a failing erase leaves the agent live and its integration in place)", async () => {
    const { session, a } = await seed();
    jest
      .spyOn(moduleRef.get(AgentIntegrationRepository), "deleteAgentIntegrations")
      .mockRejectedValueOnce(new Error("planted failure"));

    const res = await deleteAgent(a.id, session);

    expect(res.statusCode).toBe(500);
    expect(await storedAgent(a.id)).toBeNull();
    expect(await prisma.agent.count({ where: { id: a.id } })).toBe(1);
    expect(await prisma.agentIntegration.count({ where: { agentId: a.id } })).toBe(1);
  });

  describe("RNX-124 AC2: the owner no longer reaches a deleted agent", () => {
    it("the owner's list leaves it out (B and C stay)", async () => {
      const { session, a, b, c } = await seed();
      await deleteAgent(a.id, session);

      const res = await app.inject({ method: "GET", url: "/agents", headers: session });

      expect(res.statusCode).toBe(200);
      expect(res.json().map((agent: { id: string }) => agent.id).sort()).toEqual([b.id, c.id].sort());
    });

    it.each([
      ["read it", "GET", "", undefined],
      ["update it", "PATCH", "", { systemPrompt: "CHANGED" }],
      ["change its status", "PATCH", "/status", { status: "archived" }],
      ["publish it", "POST", "/publish", undefined],
      ["delete it again", "DELETE", "", undefined],
    ] as const)("%s → 404, the row unchanged", async (_label, method, suffix, payload) => {
      const seeded = await seed();
      await deleteAgent(seeded.a.id, seeded.session);
      const before = await prisma.agent.findFirst({ where: { id: seeded.a.id, deletedAt: { not: null } } });

      const res = await app.inject({ method, url: `/agents/${seeded.a.id}${suffix}`, headers: seeded.session, payload });

      expect(res.statusCode).toBe(404);
      expect(await prisma.agent.findFirst({ where: { id: seeded.a.id, deletedAt: { not: null } } })).toEqual(before);
    });
  });

  describe("RNX-124 AC2: a write that passed the owner check just before the agent was deleted (the owner check answers the live row) changes nothing → 404", () => {
    it.each([
      ["update it", "PATCH", "", { systemPrompt: "CHANGED" }],
      ["change its status", "PATCH", "/status", { status: "archived" }],
      ["publish it", "POST", "/publish", undefined],
      ["delete it again (by someone else)", "DELETE", "", undefined],
    ] as const)("%s", async (_label, method, suffix, payload) => {
      const { owner, session, a } = await seed();
      const live = await prisma.agent.findUniqueOrThrow({ where: { id: a.id } });
      await deleteAgent(a.id, session);
      const before = await prisma.agent.findFirst({ where: { id: a.id, deletedAt: { not: null } } });
      const other = await createUser(prisma);
      jest.spyOn(moduleRef.get(AgentRepository), "findUserAgent").mockResolvedValueOnce(live);

      const res = await app.inject({ method, url: `/agents/${a.id}${suffix}`, headers: asSessionUser(other), payload });

      expect(res.statusCode).toBe(404);
      expect(await prisma.agent.findFirst({ where: { id: a.id, deletedAt: { not: null } } })).toEqual(before);
      expect(before?.deletedById).toBe(owner.id);
    });
  });

  describe("RNX-124 AC4: routes that take a deleted agent's id answer 404 and change nothing", () => {
    it("the public list leaves it out and cloning it → 404, nothing created", async () => {
      const { owner, session, a } = await seed();
      await deleteAgent(a.id, session);
      const agentsBefore = await prisma.agent.count({ where: { userId: owner.id } });

      const list = await app.inject({ method: "GET", url: "/agents/public", headers: session });
      const clone = await app.inject({ method: "POST", url: `/agents/clone/${a.id}`, headers: session, payload: {} });

      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([]);
      expect(clone.statusCode).toBe(404);
      expect(await prisma.agent.count({ where: { userId: owner.id } })).toBe(agentsBefore);
    });

    it.each([
      ["add a tool", "POST", (s: Seeded) => `/agents/${s.a.id}/tools`, () => ({ toolType: "web_search" })],
      ["remove a tool", "DELETE", (s: Seeded) => `/agents/${s.a.id}/tools/${s.tool.id}`, () => undefined],
      ["add an integration", "POST", (s: Seeded) => `/agents/${s.a.id}/integrations`, () => ({ provider: "jira", config: {}, scopes: ["read"] })],
      ["remove an integration", "DELETE", (s: Seeded) => `/agents/${s.a.id}/integrations/${s.integration.id}`, () => undefined],
      ["attach knowledge", "POST", (s: Seeded) => `/agents/${s.a.id}/knowledge-bases`, (s: Seeded) => ({ knowledgeBaseId: s.kb.id })],
      ["detach knowledge", "DELETE", (s: Seeded) => `/agents/${s.a.id}/knowledge-bases/${s.kb.id}`, () => undefined],
      ["deploy a channel", "POST", (s: Seeded) => `/agents/${s.a.id}/channels`, () => ({ channelType: "web" })],
      ["update a channel", "PATCH", (s: Seeded) => `/agents/${s.a.id}/channels/${s.channel.id}`, () => ({ config: { x: 1 } })],
      ["remove a channel", "DELETE", (s: Seeded) => `/agents/${s.a.id}/channels/${s.channel.id}`, () => undefined],
      ["list its links", "GET", (s: Seeded) => `/agents/${s.a.id}/links`, () => undefined],
      ["add a link from it", "POST", (s: Seeded) => `/agents/${s.a.id}/links`, (s: Seeded) => ({ calleeAgentId: s.c.id })],
      ["add a link to it", "POST", (s: Seeded) => `/agents/${s.b.id}/links`, (s: Seeded) => ({ calleeAgentId: s.a.id })],
      ["remove a link from it", "DELETE", (s: Seeded) => `/agents/${s.a.id}/links/${s.b.id}`, () => undefined],
    ] as const)("%s → 404", async (_label, method, url, payload) => {
      const seeded = await seed();
      await deleteAgent(seeded.a.id, seeded.session);
      const before = await children(seeded.a.id);

      const res = await app.inject({
        method: method as "GET",
        url: url(seeded),
        headers: seeded.session,
        payload: (payload as (s: Seeded) => object | undefined)(seeded),
      });

      expect(res.statusCode).toBe(404);
      expect(await children(seeded.a.id)).toEqual(before);
      expect(await prisma.agentLink.count({ where: { callerAgentId: seeded.b.id } })).toBe(0);
    });
  });

  describe("RNX-124 AC5: a live agent's links and its workspace's agent count leave the deleted agent out", () => {
    it("C's links no longer list A; the link row stays and is listed again once A's deletedAt is cleared", async () => {
      const { session, a, c } = await seed();
      await deleteAgent(a.id, session);

      const hidden = await app.inject({ method: "GET", url: `/agents/${c.id}/links`, headers: session });
      await prisma.agent.updateMany({ where: { id: a.id }, data: { deletedAt: null, deletedById: null } });
      const shown = await app.inject({ method: "GET", url: `/agents/${c.id}/links`, headers: session });

      expect(hidden.statusCode).toBe(200);
      expect(hidden.json()).toEqual([]);
      expect(await prisma.agentLink.count({ where: { callerAgentId: c.id, calleeAgentId: a.id } })).toBe(1);
      expect(shown.json().map((link: { calleeAgentId: string }) => link.calleeAgentId)).toEqual([a.id]);
    });

    it("the workspace's agent count drops from 3 to 2", async () => {
      const { owner, session, workspace, a } = await seed();
      const workspaces = moduleRef.get(WorkspaceService);
      const before = await workspaces.getById(workspace.id, owner.id);

      await deleteAgent(a.id, session);
      const after = await workspaces.getById(workspace.id, owner.id);

      expect([before._count.agents, after._count.agents]).toEqual([3, 2]);
    });
  });

  it("RNX-124 AC6: the plan quota does not count a deleted agent (maxAgents 1: delete the one, create another → 201)", async () => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id, maxAgents: 1 });
    const session = asSessionUser(owner);
    const newAgent = { name: "Only One", systemPrompt: "p", model: "test-model" };
    const first = await app.inject({ method: "POST", url: "/agents", headers: session, payload: newAgent });
    const refused = await app.inject({ method: "POST", url: "/agents", headers: session, payload: { ...newAgent, name: "Second" } });

    await deleteAgent(first.json().id, session);
    const second = await app.inject({ method: "POST", url: "/agents", headers: session, payload: { ...newAgent, name: "Second" } });

    expect([first.statusCode, refused.statusCode, second.statusCode]).toEqual([201, 400, 201]);
  });

  it("RNX-124 AC7: a deleted agent's slug is free: the same user creates an agent with the same name and gets the same slug", async () => {
    const owner = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: owner.id, maxAgents: 5 });
    const session = asSessionUser(owner);
    const newAgent = { name: "Support Bot", systemPrompt: "p", model: "test-model" };
    const first = await app.inject({ method: "POST", url: "/agents", headers: session, payload: newAgent });
    const live = await app.inject({ method: "POST", url: "/agents", headers: session, payload: newAgent });

    await deleteAgent(first.json().id, session);
    const reused = await app.inject({ method: "POST", url: "/agents", headers: session, payload: newAgent });

    expect([first.statusCode, live.statusCode, reused.statusCode]).toEqual([201, 201, 201]);
    expect([first.json().slug, live.json().slug, reused.json().slug]).toEqual(["support-bot", "support-bot-1", "support-bot"]);
    expect(await prisma.agent.count({ where: { userId: owner.id, slug: "support-bot", deletedAt: { not: null } } })).toBe(1);
  });

  it("RNX-124 AC7: the database still refuses two live agents of one user with one slug (the partial unique index)", async () => {
    const owner = await createUser(prisma);
    await createAgent(prisma, { userId: owner.id, slug: "twin" });

    await expect(createAgent(prisma, { userId: owner.id, slug: "twin" })).rejects.toMatchObject({ code: "P2002" });
  });

  it("RNX-124 AC9: another user deletes A → 404 and nothing changes", async () => {
    const { a } = await seed();
    const stranger = await createUser(prisma);
    const before = await children(a.id);

    const res = await deleteAgent(a.id, asSessionUser(stranger));

    expect(res.statusCode).toBe(404);
    expect(await storedAgent(a.id)).toBeNull();
    expect(await prisma.agent.findUnique({ where: { id: a.id }, select: { deletedAt: true } })).toEqual({ deletedAt: null });
    expect(await children(a.id)).toEqual(before);
  });
});
