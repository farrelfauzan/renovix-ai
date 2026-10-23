import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentController } from "./agent.controller";
import { AgentService } from "../service/agent.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { ensureDefaultWorkspace } from "../../workspace/repository/ensure-default-workspace";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-203: a user owns an agent when they own its workspace (agent.workspace.ownerId); agent.userId is only the
// creator. The rows where the two rules differ (creator B, workspace owned by A) are written straight to the database.
// Create and clone take an optional workspaceId the caller must own (403). Real controller and service, test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

type User = { id: string; email: string };

describe("RNX-203: agent ownership through the workspace owner (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController],
      providers: [AgentService, AgentRunPolicyService, WorkspaceService, WorkspaceQuotaService, { provide: ProviderRouter, useValue: {} }, { provide: ModelRegistryService, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: User) => asSessionUser(user);

  const subscribe = async (user: User) => {
    const plan = await createPlan(prisma, { maxAgents: 50 });
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
  };

  /** Workspace W owned by the owner; the agent in W was created by the creator, who is not a member of W. */
  const seedAgentInOwnersWorkspace = async () => {
    const owner = await createUser(prisma);
    const creator = await createUser(prisma);
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, { userId: creator.id, workspaceId: workspace.id, name: "Shared agent" });
    return { owner, creator, workspace, agent };
  };

  const newAgent = { name: "New agent", systemPrompt: "prompt", model: "test-model" };

  describe("create and clone into a workspace", () => {
    it("POST /agents with a workspaceId of a workspace the caller does not own (an admin member there): 403, nothing stored", async () => {
      const caller = await createUser(prisma);
      const other = await createUser(prisma);
      await subscribe(caller);
      const foreign = await createWorkspace(prisma, { ownerId: other.id });
      await prisma.workspaceMember.create({
        data: { workspaceId: foreign.id, userId: caller.id, role: "admin", status: "active" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/agents",
        headers: auth(caller),
        payload: { ...newAgent, workspaceId: foreign.id },
      });

      expect(res.statusCode).toBe(403);
      expect(await prisma.agent.count()).toBe(0);
    });

    it("POST /agents/clone/:templateId with a workspaceId the caller does not own: 403, nothing stored", async () => {
      const caller = await createUser(prisma);
      const other = await createUser(prisma);
      await subscribe(caller);
      const template = await createAgent(prisma, { userId: other.id, isPublic: true, status: "active" });
      const foreign = await createWorkspace(prisma, { ownerId: other.id });

      const res = await app.inject({
        method: "POST",
        url: `/agents/clone/${template.id}`,
        headers: auth(caller),
        payload: { workspaceId: foreign.id },
      });

      expect(res.statusCode).toBe(403);
      expect(await prisma.agent.count({ where: { userId: caller.id } })).toBe(0);
      expect(await prisma.agent.count({ where: { workspaceId: foreign.id } })).toBe(0);
    });

    it("POST /agents and POST /agents/clone/:templateId put the agent in the caller's own workspace when given", async () => {
      const caller = await createUser(prisma);
      const other = await createUser(prisma);
      await subscribe(caller);
      const own = await createWorkspace(prisma, { ownerId: caller.id });
      const template = await createAgent(prisma, { userId: other.id, isPublic: true, status: "active" });

      const created = await app.inject({
        method: "POST",
        url: "/agents",
        headers: auth(caller),
        payload: { ...newAgent, workspaceId: own.id },
      });
      const cloned = await app.inject({
        method: "POST",
        url: `/agents/clone/${template.id}`,
        headers: auth(caller),
        payload: { workspaceId: own.id },
      });

      expect([created.statusCode, cloned.statusCode]).toEqual([201, 201]);
      expect([created.json().workspaceId, cloned.json().workspaceId]).toEqual([own.id, own.id]);
    });

    it("without a workspaceId, create and clone use the caller's default workspace (control)", async () => {
      const caller = await createUser(prisma);
      const other = await createUser(prisma);
      await subscribe(caller);
      await createWorkspace(prisma, { ownerId: caller.id });
      const template = await createAgent(prisma, { userId: other.id, isPublic: true, status: "active" });

      const created = await app.inject({ method: "POST", url: "/agents", headers: auth(caller), payload: newAgent });
      const cloned = await app.inject({ method: "POST", url: `/agents/clone/${template.id}`, headers: auth(caller) });

      const personal = await ensureDefaultWorkspace(prisma, caller.id);
      expect([created.statusCode, cloned.statusCode]).toEqual([201, 201]);
      expect([created.json().workspaceId, cloned.json().workspaceId]).toEqual([personal.id, personal.id]);
    });

    it("POST /agents/clone/:templateId with a workspaceId that is not a uuid: 400, nothing stored", async () => {
      const caller = await createUser(prisma);
      const other = await createUser(prisma);
      await subscribe(caller);
      const template = await createAgent(prisma, { userId: other.id, isPublic: true, status: "active" });

      const res = await app.inject({
        method: "POST",
        url: `/agents/clone/${template.id}`,
        headers: auth(caller),
        payload: { workspaceId: "not-a-uuid" },
      });

      expect(res.statusCode).toBe(400);
      expect(await prisma.agent.count({ where: { userId: caller.id } })).toBe(0);
    });
  });

  describe("read and list", () => {
    it("the creator who does not own the workspace: GET /agents/:id is 404 and the list leaves it out", async () => {
      const { creator, agent } = await seedAgentInOwnersWorkspace();

      const read = await app.inject({ method: "GET", url: `/agents/${agent.id}`, headers: auth(creator) });
      const list = await app.inject({ method: "GET", url: "/agents", headers: auth(creator) });

      expect(read.statusCode).toBe(404);
      expect(list.json().map((a: { id: string }) => a.id)).not.toContain(agent.id);
    });

    it("the workspace owner who did not create it reads it and sees it in the list (positive control)", async () => {
      const { owner, agent } = await seedAgentInOwnersWorkspace();

      const read = await app.inject({ method: "GET", url: `/agents/${agent.id}`, headers: auth(owner) });
      const list = await app.inject({ method: "GET", url: "/agents", headers: auth(owner) });

      expect(read.statusCode).toBe(200);
      expect(read.json().id).toBe(agent.id);
      expect(list.json().map((a: { id: string }) => a.id)).toEqual([agent.id]);
    });
  });

  describe("change, delete, tools and channels", () => {
    /** What each route changes, read back from the database. */
    const effects = {
      update: async (id: string) => (await prisma.agent.findUnique({ where: { id } }))?.description,
      status: async (id: string) => (await prisma.agent.findUnique({ where: { id } }))?.status,
      delete: async (id: string) => prisma.agent.count({ where: { id } }),
      tools: async (id: string) => prisma.agentTool.count({ where: { agentId: id } }),
      channels: async (id: string) => prisma.agentChannel.count({ where: { agentId: id } }),
    };

    const routes = [
      ["PATCH", "", { description: "changed" }, "update", null, "changed"],
      ["PATCH", "/status", { status: "archived" }, "status", "draft", "archived"],
      ["POST", "/publish", undefined, "status", "draft", "active"],
      ["DELETE", "", undefined, "delete", 1, 0],
      ["POST", "/tools", { toolType: "calculator" }, "tools", 0, 1],
      ["POST", "/channels", { channelType: "web" }, "channels", 0, 1],
    ] as const;

    it.each(routes)(
      "the creator who does not own the workspace: %s /agents/:id%s is 404, nothing changes",
      async (method, suffix, payload, effect, unchanged) => {
        const { creator, agent } = await seedAgentInOwnersWorkspace();

        const res = await app.inject({ method, url: `/agents/${agent.id}${suffix}`, headers: auth(creator), payload });

        expect(res.statusCode).toBe(404);
        expect(await effects[effect](agent.id)).toBe(unchanged);
      },
    );

    it.each(routes)(
      "the workspace owner who did not create it: %s /agents/:id%s succeeds (positive control)",
      async (method, suffix, payload, effect, _unchanged, changed) => {
        const { owner, agent } = await seedAgentInOwnersWorkspace();

        const res = await app.inject({ method, url: `/agents/${agent.id}${suffix}`, headers: auth(owner), payload });

        expect(res.statusCode).toBeLessThan(300);
        expect(await effects[effect](agent.id)).toBe(changed);
      },
    );
  });

  describe("knowledge bases", () => {
    const attach = (user: User, agentId: string, knowledgeBaseId: string) =>
      app.inject({
        method: "POST",
        url: `/agents/${agentId}/knowledge-bases`,
        headers: auth(user),
        payload: { knowledgeBaseId },
      });

    it("the creator who does not own the workspace cannot attach their own knowledge base: 404, nothing stored", async () => {
      const { creator, agent } = await seedAgentInOwnersWorkspace();
      const kb = await prisma.knowledgeBase.create({ data: { userId: creator.id, name: "Creator KB" } });

      const res = await attach(creator, agent.id, kb.id);

      expect(res.statusCode).toBe(404);
      expect(await prisma.agentKnowledgeBase.count({ where: { agentId: agent.id } })).toBe(0);
    });

    it("the workspace owner who did not create it attaches their own knowledge base (positive control)", async () => {
      const { owner, agent } = await seedAgentInOwnersWorkspace();
      const kb = await prisma.knowledgeBase.create({ data: { userId: owner.id, name: "Owner KB" } });

      const res = await attach(owner, agent.id, kb.id);

      expect(res.statusCode).toBe(201);
      expect(await prisma.agentKnowledgeBase.count({ where: { agentId: agent.id } })).toBe(1);
    });
  });

  // RNX-118: parent and sub-agents became links; "both agents in one workspace" (403) is agent-link.routes.spec.ts.
});
