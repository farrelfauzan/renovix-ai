import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentController } from "./agent.controller";
import { AgentLinkController } from "./agent-link.controller";
import { AgentService } from "../service/agent.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { AgentLinkService } from "../service/agent-link.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";

// RNX-260 (119b; D259, PRD 10 R14): only the workspace owner changes an agent. A collaborator (an active member of an
// Enterprise owner's workspace, the run policy's "inside"; a stale "admin" row counts as one) gets 403 on every agent
// write route and nothing changes; a person outside the workspace gets 404, as for an agent they cannot see; the owner
// succeeds (positive control). A better-auth session cannot be produced in tests (ESM-only): `getSession` is a mock
// that returns the user whose id is the session cookie. Real controllers and services, test database.
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const COOKIE_NAME = "better-auth.session_token";

type User = { id: string; email: string };

describe("RNX-260: agent writes are the workspace owner's (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const users = new Map<string, User>();

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController, AgentLinkController],
      providers: [
        AgentService,
        EntitlementService,
        AgentLinkService,
        AgentRunPolicyService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    mockGetSession.mockImplementation(async ({ headers }: { headers: Headers }) => {
      const token = (headers.get("cookie") ?? "").replace(`${COOKIE_NAME}=`, "");
      const user = users.get(token);
      return user ? { user: { id: user.id, email: user.email }, session: { id: `s-${user.id}` } } : null;
    });
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    users.clear();
  });

  afterAll(() => app?.close());

  /** A signed-in session of this user (the mocked getSession returns them for this cookie). */
  const session = (user: User) => {
    users.set(user.id, user);
    return { cookie: `${COOKIE_NAME}=${user.id}` };
  };

  /**
   * An Enterprise owner's workspace W with agent A (draft, one tool, one attached workspace knowledge base, one
   * deployed "api" channel) and agent B; a collaborator (member row "member"), a stale "admin" row, and an outsider with no
   * member row. Everyone is subscribed.
   */
  const setup = async () => {
    const plan = await createPlan(prisma, { slug: "enterprise", maxAgents: 50, maxWorkspaceUsers: 100 });
    const [owner, collaborator, staleAdmin, outsider] = await Promise.all([1, 2, 3, 4].map(() => createUser(prisma)));
    for (const user of [owner, collaborator, staleAdmin, outsider]) {
      await createSubscription(prisma, { userId: user.id, planId: plan.id });
    }
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const member = (userId: string, role: string) =>
      prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId, role, status: "active", joinedAt: new Date() } });
    await member(owner.id, "owner");
    await member(collaborator.id, "member");
    await member(staleAdmin.id, "admin");
    const a = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: "Agent A", systemPrompt: "ORIGINAL" });
    const b = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: "Agent B" });
    const tool = await prisma.agentTool.create({ data: { agentId: a.id, toolType: "calculator" } });
    const attachedKb = await prisma.knowledgeBase.create({ data: { userId: owner.id, workspaceId: workspace.id, name: "Attached" } });
    const freeKb = await prisma.knowledgeBase.create({ data: { userId: owner.id, workspaceId: workspace.id, name: "Free" } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: a.id, knowledgeBaseId: attachedKb.id } });
    const channel = await prisma.agentChannel.create({ data: { agentId: a.id, channelType: "api", status: "active" } });
    await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: b.id } });
    return { owner, collaborator, staleAdmin, outsider, workspace, a, b, tool, attachedKb, freeKb, channel };
  };
  type Seeded = Awaited<ReturnType<typeof setup>>;

  /** Every row an agent write could change, read back from the database. */
  const snapshot = async (agentId: string) => ({
    agent: await prisma.agent.findUnique({ where: { id: agentId }, select: { systemPrompt: true, status: true } }),
    tools: await prisma.agentTool.count({ where: { agentId } }),
    knowledge: await prisma.agentKnowledgeBase.count({ where: { agentId } }),
    channels: await prisma.agentChannel.count({ where: { agentId } }),
    links: await prisma.agentLink.count({ where: { callerAgentId: agentId } }),
  });

  /** The agent write routes of Scope 2: [label, method, url, payload], and what the owner's call changes. */
  const routes = [
    ["edit the agent (behaviour: its prompt)", "PATCH", (s: Seeded) => `/agents/${s.a.id}`, () => ({ systemPrompt: "CHANGED" }), { agent: { systemPrompt: "CHANGED", status: "draft" } }],
    ["change its status", "PATCH", (s: Seeded) => `/agents/${s.a.id}/status`, () => ({ status: "archived" }), { agent: { systemPrompt: "ORIGINAL", status: "archived" } }],
    ["deploy (publish) it", "POST", (s: Seeded) => `/agents/${s.a.id}/publish`, () => undefined, { agent: { systemPrompt: "ORIGINAL", status: "active" } }],
    ["delete it", "DELETE", (s: Seeded) => `/agents/${s.a.id}`, () => undefined, { agent: null, tools: 0, knowledge: 0, channels: 0, links: 0 }],
    ["add a tool", "POST", (s: Seeded) => `/agents/${s.a.id}/tools`, () => ({ toolType: "web_search" }), { tools: 2 }],
    ["remove a tool", "DELETE", (s: Seeded) => `/agents/${s.a.id}/tools/${s.tool.id}`, () => undefined, { tools: 0 }],
    ["attach knowledge", "POST", (s: Seeded) => `/agents/${s.a.id}/knowledge-bases`, (s: Seeded) => ({ knowledgeBaseId: s.freeKb.id }), { knowledge: 2 }],
    ["detach knowledge", "DELETE", (s: Seeded) => `/agents/${s.a.id}/knowledge-bases/${s.attachedKb.id}`, () => undefined, { knowledge: 0 }],
    ["deploy a channel", "POST", (s: Seeded) => `/agents/${s.a.id}/channels`, () => ({ channelType: "web" }), { channels: 2 }],
    ["remove a channel", "DELETE", (s: Seeded) => `/agents/${s.a.id}/channels/${s.channel.id}`, () => undefined, { channels: 0 }],
  ] as const;

  /** The link routes (RNX-118), with the same 403 inside and 404 outside. */
  const linkRoutes = [
    ["add a link", "POST", (s: Seeded) => `/agents/${s.b.id}/links`, (s: Seeded) => ({ calleeAgentId: s.a.id })],
    ["remove a link", "DELETE", (s: Seeded) => `/agents/${s.a.id}/links/${s.b.id}`, () => undefined],
  ] as const;

  const call = (seeded: Seeded, user: User, method: string, url: (s: Seeded) => string, payload: (s: Seeded) => object | undefined) =>
    app.inject({ method: method as "GET", url: url(seeded), headers: session(user), payload: payload(seeded) });

  describe("AC1: a collaborator is refused on every agent write route (403, nothing changes)", () => {
    it.each(routes)("a collaborator: %s → 403, nothing changes", async (_label, method, url, payload) => {
      const seeded = await setup();
      const before = await snapshot(seeded.a.id);

      const res = await call(seeded, seeded.collaborator, method, url, payload);

      expect(res.statusCode).toBe(403);
      expect(await snapshot(seeded.a.id)).toEqual(before);
    });

    it.each(routes)("a stale admin row: %s → 403, nothing changes", async (_label, method, url, payload) => {
      const seeded = await setup();
      const before = await snapshot(seeded.a.id);

      const res = await call(seeded, seeded.staleAdmin, method, url, payload);

      expect(res.statusCode).toBe(403);
      expect(await snapshot(seeded.a.id)).toEqual(before);
    });

    it.each(linkRoutes)("a collaborator: %s → 403, nothing changes", async (_label, method, url, payload) => {
      const seeded = await setup();
      const before = [await snapshot(seeded.a.id), await snapshot(seeded.b.id)];

      const res = await call(seeded, seeded.collaborator, method, url, payload);

      expect(res.statusCode).toBe(403);
      expect([await snapshot(seeded.a.id), await snapshot(seeded.b.id)]).toEqual(before);
    });

    it("a collaborator creating or cloning an agent into the owner's workspace → 403, nothing stored", async () => {
      const seeded = await setup();
      const template = await createAgent(prisma, { userId: seeded.outsider.id, isPublic: true, status: "active" });
      const agentsBefore = await prisma.agent.count();

      const created = await app.inject({
        method: "POST",
        url: "/agents",
        headers: session(seeded.collaborator),
        payload: { name: "Mine", systemPrompt: "p", model: "test-model", workspaceId: seeded.workspace.id },
      });
      const cloned = await app.inject({
        method: "POST",
        url: `/agents/clone/${template.id}`,
        headers: session(seeded.collaborator),
        payload: { workspaceId: seeded.workspace.id },
      });

      expect([created.statusCode, cloned.statusCode]).toEqual([403, 403]);
      expect(await prisma.agent.count()).toBe(agentsBefore);
    });

    it.each(routes)("the owner: %s succeeds (positive control)", async (_label, method, url, payload, changed) => {
      const seeded = await setup();
      const before = await snapshot(seeded.a.id);

      const res = await call(seeded, seeded.owner, method, url, payload);

      expect(res.statusCode).toBeLessThan(300);
      expect(await snapshot(seeded.a.id)).toEqual({ ...before, ...changed });
    });

    it.each(linkRoutes)("the owner: %s succeeds (positive control)", async (_label, method, url, payload) => {
      const seeded = await setup();

      const res = await call(seeded, seeded.owner, method, url, payload);

      expect(res.statusCode).toBeLessThan(300);
    });
  });

  describe("AC3: outside the workspace an agent write is 404, inside it 403", () => {
    it.each(routes)("a person outside the workspace: %s → 404, nothing changes", async (_label, method, url, payload) => {
      const seeded = await setup();
      const before = await snapshot(seeded.a.id);

      const res = await call(seeded, seeded.outsider, method, url, payload);

      expect(res.statusCode).toBe(404);
      expect(await snapshot(seeded.a.id)).toEqual(before);
    });

    it.each(linkRoutes)("a person outside the workspace: %s → 404, nothing changes", async (_label, method, url, payload) => {
      const seeded = await setup();
      const before = [await snapshot(seeded.a.id), await snapshot(seeded.b.id)];

      const res = await call(seeded, seeded.outsider, method, url, payload);

      expect(res.statusCode).toBe(404);
      expect([await snapshot(seeded.a.id), await snapshot(seeded.b.id)]).toEqual(before);
    });

    it("a removed member and a member of a Pro owner's workspace (not inside, D64) get 404, not 403", async () => {
      const seeded = await setup();
      await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: seeded.workspace.id, userId: seeded.collaborator.id } },
        data: { status: "removed" },
      });
      const pro = await createPlan(prisma, { slug: "pro" });
      await prisma.userSubscription.update({ where: { userId: seeded.owner.id }, data: { planId: pro.id } });

      const removed = await call(seeded, seeded.collaborator, "PATCH", (s) => `/agents/${s.a.id}`, () => ({ systemPrompt: "X" }));
      const proMember = await call(seeded, seeded.staleAdmin, "PATCH", (s) => `/agents/${s.a.id}`, () => ({ systemPrompt: "X" }));

      expect([removed.statusCode, proMember.statusCode]).toEqual([404, 404]);
      expect((await prisma.agent.findUnique({ where: { id: seeded.a.id } }))?.systemPrompt).toBe("ORIGINAL");
    });
  });
});
