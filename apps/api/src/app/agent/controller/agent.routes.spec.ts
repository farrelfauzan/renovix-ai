import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { AgentController } from "./agent.controller";
import { AgentService } from "../service/agent.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
} from "../../../../test/factories";

// RX-133: the agent routes that the ownership suites (RX-15 agent.ownership.spec.ts, RX-112
// agent.parent-owner.spec.ts) and RX-115 (agent.whatsapp-channel.spec.ts) do not cover, written
// against the code before its queries moved into repositories. Real controller and service, test
// database. No route used here calls a model, so ProviderRouter is an empty stub.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

process.env.JWT_SECRET = "rx133-test-jwt-secret";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("RX-133: agent routes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController],
      providers: [AgentService, WorkspaceService, WorkspaceQuotaService, { provide: ProviderRouter, useValue: {} }, { provide: ModelRegistryService, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  const subscribed = async (plan: Parameters<typeof createPlan>[1] = {}, status = "active") => {
    const user = await createUser(prisma);
    const created = await createPlan(prisma, plan);
    await createSubscription(prisma, { userId: user.id, planId: created.id, status });
    return { user, plan: created };
  };

  const newAgent = { name: "My Agent", systemPrompt: "prompt", model: "test-model" };

  describe("POST /agents", () => {
    it.each([
      ["no subscription", null],
      ["a canceled subscription", "canceled"],
    ])("with %s: 403, nothing stored", async (_name, status) => {
      const user = status ? (await subscribed({}, status)).user : await createUser(prisma);

      const res = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe(
        "Active subscription required to use AI Agents. Please subscribe to access this feature.",
      );
      expect(await prisma.agent.count()).toBe(0);
    });

    it("at the plan's agent limit (counting only the caller's agents): 400, nothing stored", async () => {
      const { user, plan } = await subscribed({ maxAgents: 1, name: "Starter" });
      await createAgent(prisma, { userId: user.id });
      const other = await createUser(prisma);
      await createAgent(prisma, { userId: other.id });

      const res = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe(
        "Agent limit reached for your Starter plan (1 agents). Please upgrade to create more.",
      );
      expect(await prisma.agent.count({ where: { userId: user.id } })).toBe(1);
      expect(plan.maxAgents).toBe(1);
    });

    it("only the caller's agents count toward the limit: another user's agent does not block (201)", async () => {
      const { user } = await subscribed({ maxAgents: 1 });
      await createAgent(prisma, { userId: (await createUser(prisma)).id });

      const res = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });

      expect(res.statusCode).toBe(201);
    });

    it("creates with the defaults and the relations; the slug is unique per user only", async () => {
      const { user } = await subscribed({ maxAgents: 10 });
      const other = await createUser(prisma);
      await createAgent(prisma, { userId: other.id, slug: "my-agent" });

      const first = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });
      const second = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });

      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        userId: user.id,
        name: "My Agent",
        slug: "my-agent",
        temperature: 0.7,
        isPublic: false,
        agentType: "standalone",
        parentAgentId: null,
        status: "draft",
        tools: [],
        integrations: [],
        knowledgeBases: [],
        channels: [],
        _count: { runs: 0 },
      });
      expect(second.statusCode).toBe(201);
      expect(second.json().slug).toBe("my-agent-1");
    });
  });

  describe("owner changes", () => {
    it("PATCH /agents/:id with a new name gives the next free slug of the caller", async () => {
      const user = await createUser(prisma);
      await createAgent(prisma, { userId: user.id, slug: "renamed" });
      const agent = await createAgent(prisma, { userId: user.id });

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        headers: auth(user),
        payload: { name: "Renamed", temperature: 0.2 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: agent.id,
        name: "Renamed",
        slug: "renamed-1",
        temperature: 0.2,
        tools: [],
        integrations: [],
        knowledgeBases: [],
        channels: [],
        _count: { runs: 0 },
      });
    });

    it("DELETE /agents/:id: 204, the agent is gone", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });

      const res = await app.inject({ method: "DELETE", url: `/agents/${agent.id}`, headers: auth(user) });

      expect(res.statusCode).toBe(204);
      expect(await prisma.agent.findUnique({ where: { id: agent.id } })).toBeNull();
    });

    it("DELETE /agents/:id of an unknown agent: 404", async () => {
      const user = await createUser(prisma);

      const res = await app.inject({ method: "DELETE", url: `/agents/${UNKNOWN_ID}`, headers: auth(user) });

      expect(res.statusCode).toBe(404);
    });

    it("PATCH /agents/:id/status: 200 with the new status; an invalid status is 400", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });

      const ok = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}/status`,
        headers: auth(user),
        payload: { status: "archived" },
      });
      const bad = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}/status`,
        headers: auth(user),
        payload: { status: "deleted" },
      });

      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ id: agent.id, status: "archived" });
      expect(bad.statusCode).toBe(400);
      expect((await prisma.agent.findUnique({ where: { id: agent.id } }))?.status).toBe("archived");
    });

    it("POST /agents/:id/publish: 200, status active", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });

      const res = await app.inject({ method: "POST", url: `/agents/${agent.id}/publish`, headers: auth(user) });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: agent.id, status: "active" });
    });
  });

  describe("GET /agents/public", () => {
    it("lists public active agents only, newest first, with the owner's email and the run count", async () => {
      const user = await createUser(prisma);
      const older = await createAgent(prisma, {
        userId: user.id,
        isPublic: true,
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      const newer = await createAgent(prisma, {
        userId: user.id,
        isPublic: true,
        status: "active",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      });
      await createAgent(prisma, { userId: user.id, isPublic: true, status: "draft" });
      await createAgent(prisma, { userId: user.id, isPublic: false, status: "active" });

      const res = await app.inject({ method: "GET", url: "/agents/public", headers: auth(user) });

      expect(res.statusCode).toBe(200);
      expect(res.json().map((a: { id: string }) => a.id)).toEqual([newer.id, older.id]);
      expect(Object.keys(res.json()[0]).sort()).toEqual(
        ["_count", "agentType", "avatar", "description", "id", "model", "name", "slug", "user"].sort(),
      );
      expect(res.json()[0]).toMatchObject({ user: { email: user.email }, _count: { runs: 0 } });
    });
  });

  describe("POST /agents/clone/:templateId", () => {
    const template = async (data: Partial<Parameters<typeof createAgent>[1]> = {}) => {
      const author = await createUser(prisma);
      const agent = await createAgent(prisma, {
        userId: author.id,
        name: "Template",
        isPublic: true,
        status: "active",
        agentType: "parent",
        temperature: 0.3,
        ...data,
      });
      await prisma.agentTool.create({
        data: { agentId: agent.id, toolType: "calculator", config: { precision: 2 }, enabled: false },
      });
      return agent;
    };

    it.each([
      ["private", { isPublic: false }],
      ["draft", { status: "draft" }],
    ])("a %s template: 404, nothing stored", async (_name, data) => {
      const { user } = await subscribed();
      const tpl = await template(data);

      const res = await app.inject({ method: "POST", url: `/agents/clone/${tpl.id}`, headers: auth(user) });

      expect(res.statusCode).toBe(404);
      expect(await prisma.agent.count({ where: { userId: user.id } })).toBe(0);
    });

    it("without a subscription: 403", async () => {
      const user = await createUser(prisma);
      const tpl = await template();

      const res = await app.inject({ method: "POST", url: `/agents/clone/${tpl.id}`, headers: auth(user) });

      expect(res.statusCode).toBe(403);
    });

    it("copies the template and its tools; a parent becomes standalone, the copy is private", async () => {
      const { user } = await subscribed();
      const tpl = await template();

      const res = await app.inject({ method: "POST", url: `/agents/clone/${tpl.id}`, headers: auth(user) });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        userId: user.id,
        name: "Template",
        slug: "template",
        temperature: 0.3,
        isPublic: false,
        agentType: "standalone",
        integrations: [],
        knowledgeBases: [],
        channels: [],
        _count: { runs: 0 },
      });
      expect(res.json().tools).toEqual([
        expect.objectContaining({ toolType: "calculator", config: { precision: 2 }, enabled: false }),
      ]);
    });
  });

  describe("GET /agents/subscription", () => {
    it("without a subscription: { subscription: null }", async () => {
      const user = await createUser(prisma);

      const res = await app.inject({ method: "GET", url: "/agents/subscription", headers: auth(user) });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ subscription: null });
    });

    it("with one: the plan inline, big numbers as strings, the price as a number", async () => {
      const { user, plan } = await subscribed({ priceMonthly: 99000, maxTokensPerMonth: 5_000_000n });

      const res = await app.inject({ method: "GET", url: "/agents/subscription", headers: auth(user) });

      expect(res.statusCode).toBe(200);
      expect(res.json().subscription).toMatchObject({
        userId: user.id,
        planId: plan.id,
        status: "active",
        tokensUsed: "0",
        plan: { id: plan.id, maxTokensPerMonth: "5000000", priceMonthly: 99000 },
      });
    });

    it("returns the caller's plan, not another user's", async () => {
      await subscribed({ name: "Other" });
      const { user, plan } = await subscribed({ name: "Mine" });

      const res = await app.inject({ method: "GET", url: "/agents/subscription", headers: auth(user) });

      expect(res.statusCode).toBe(200);
      expect(res.json().subscription).toMatchObject({ userId: user.id, planId: plan.id });
    });
  });

  describe("tools", () => {
    it("owner attaches (201) and removes (204) a tool", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });

      const attach = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/tools`,
        headers: auth(user),
        payload: { toolType: "web_search", config: { depth: 1 }, enabled: false },
      });
      const remove = await app.inject({
        method: "DELETE",
        url: `/agents/${agent.id}/tools/${attach.json().id}`,
        headers: auth(user),
      });

      expect(attach.statusCode).toBe(201);
      expect(attach.json()).toMatchObject({ agentId: agent.id, toolType: "web_search", config: { depth: 1 }, enabled: false });
      expect(remove.statusCode).toBe(204);
      expect(await prisma.agentTool.count()).toBe(0);
    });

    it("a tool of the caller's other agent, through this agent: 404, kept", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      const otherAgent = await createAgent(prisma, { userId: user.id });
      const tool = await prisma.agentTool.create({ data: { agentId: otherAgent.id, toolType: "calculator" } });

      const res = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/tools/${tool.id}`, headers: auth(user) });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Tool not found");
      expect(await prisma.agentTool.count()).toBe(1);
    });

    it("another user removes a tool of my agent: 404 (agent not found), kept", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: alice.id });
      const tool = await prisma.agentTool.create({ data: { agentId: agent.id, toolType: "calculator" } });

      const res = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/tools/${tool.id}`, headers: auth(bob) });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Agent not found");
      expect(await prisma.agentTool.count()).toBe(1);
    });
  });

  describe("integrations", () => {
    const integration = { provider: "jira", config: { baseUrl: "https://jira.test.local" }, scopes: ["read"] };

    it("owner without a subscription attaches (201, connected) and removes (204) one; no limit applies", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      await prisma.agentIntegration.create({ data: { agentId: agent.id, provider: "plane", config: {}, scopes: ["read"] } });

      const attach = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/integrations`,
        headers: auth(user),
        payload: integration,
      });
      const remove = await app.inject({
        method: "DELETE",
        url: `/agents/${agent.id}/integrations/${attach.json().id}`,
        headers: auth(user),
      });

      expect(attach.statusCode).toBe(201);
      expect(attach.json()).toMatchObject({ agentId: agent.id, provider: "jira", scopes: ["read"], status: "connected" });
      expect(remove.statusCode).toBe(204);
      expect(await prisma.agentIntegration.count()).toBe(1);
    });

    it("at the plan's integration limit (counted on this agent): 400, nothing stored", async () => {
      const { user } = await subscribed({ maxIntegrations: 1, name: "Starter" });
      const agent = await createAgent(prisma, { userId: user.id });
      const otherAgent = await createAgent(prisma, { userId: user.id });
      await prisma.agentIntegration.create({ data: { agentId: otherAgent.id, provider: "plane", config: {}, scopes: ["read"] } });

      const first = await app.inject({ method: "POST", url: `/agents/${agent.id}/integrations`, headers: auth(user), payload: integration });
      const second = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/integrations`,
        headers: auth(user),
        payload: { ...integration, provider: "github" },
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(400);
      expect(second.json().message).toBe("Integration limit reached for your Starter plan. Please upgrade.");
      expect(await prisma.agentIntegration.count({ where: { agentId: agent.id } })).toBe(1);
    });

    it("an integration of the caller's other agent, through this agent: 404, kept", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      const otherAgent = await createAgent(prisma, { userId: user.id });
      const row = await prisma.agentIntegration.create({ data: { agentId: otherAgent.id, provider: "plane", config: {}, scopes: ["read"] } });

      const res = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/integrations/${row.id}`, headers: auth(user) });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Integration not found");
      expect(await prisma.agentIntegration.count()).toBe(1);
    });

    it("another user attaches to or removes from my agent: 404, nothing changed", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: alice.id });
      const row = await prisma.agentIntegration.create({ data: { agentId: agent.id, provider: "plane", config: {}, scopes: ["read"] } });

      const attach = await app.inject({ method: "POST", url: `/agents/${agent.id}/integrations`, headers: auth(bob), payload: integration });
      const remove = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/integrations/${row.id}`, headers: auth(bob) });

      expect(attach.statusCode).toBe(404);
      expect(remove.statusCode).toBe(404);
      expect(await prisma.agentIntegration.count()).toBe(1);
    });
  });

  describe("knowledge bases", () => {
    it("owner attaches their personal base (201) and removes it by the base id (204)", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      const kb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "Mine" } });

      const attach = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/knowledge-bases`,
        headers: auth(user),
        payload: { knowledgeBaseId: kb.id },
      });
      const remove = await app.inject({
        method: "DELETE",
        url: `/agents/${agent.id}/knowledge-bases/${kb.id}`,
        headers: auth(user),
      });

      expect(attach.statusCode).toBe(201);
      expect(attach.json()).toMatchObject({ agentId: agent.id, knowledgeBaseId: kb.id });
      expect(remove.statusCode).toBe(204);
      expect(await prisma.agentKnowledgeBase.count()).toBe(0);
    });

    it.each([["another user's personal base"], ["an unknown base"]])("attaching %s: 404, nothing stored", async (name) => {
      const user = await createUser(prisma);
      const other = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      const kb = await prisma.knowledgeBase.create({ data: { userId: other.id, name: "Theirs" } });
      const knowledgeBaseId = name === "an unknown base" ? UNKNOWN_ID : kb.id;

      const res = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/knowledge-bases`,
        headers: auth(user),
        payload: { knowledgeBaseId },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Knowledge base not found");
      expect(await prisma.agentKnowledgeBase.count()).toBe(0);
    });

    it("removing a base attached to the caller's other agent, through this agent: 404, kept", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      const otherAgent = await createAgent(prisma, { userId: user.id });
      const kb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "Mine" } });
      await prisma.agentKnowledgeBase.create({ data: { agentId: otherAgent.id, knowledgeBaseId: kb.id } });

      const res = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/knowledge-bases/${kb.id}`, headers: auth(user) });

      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Knowledge base attachment not found");
      expect(await prisma.agentKnowledgeBase.count()).toBe(1);
    });

    it("another user removes a base from my agent: 404, kept", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: alice.id });
      const kb = await prisma.knowledgeBase.create({ data: { userId: alice.id, name: "Mine" } });
      await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: kb.id } });

      const res = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/knowledge-bases/${kb.id}`, headers: auth(bob) });

      expect(res.statusCode).toBe(404);
      expect(await prisma.agentKnowledgeBase.count()).toBe(1);
    });
  });

  describe("channels", () => {
    it("owner deploys a web channel (201, active) and removes it (204)", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });

      const deploy = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/channels`,
        headers: auth(user),
        payload: { channelType: "web", config: { theme: "dark" } },
      });
      const remove = await app.inject({
        method: "DELETE",
        url: `/agents/${agent.id}/channels/${deploy.json().id}`,
        headers: auth(user),
      });

      expect(deploy.statusCode).toBe(201);
      expect(deploy.json()).toMatchObject({ agentId: agent.id, channelType: "web", config: { theme: "dark" }, status: "active" });
      expect(remove.statusCode).toBe(204);
      expect(await prisma.agentChannel.count()).toBe(0);
    });

    it("a channel type the plan does not allow: 403, nothing stored", async () => {
      const { user } = await subscribed({ allowedChannels: ["web"], name: "Starter" });
      const agent = await createAgent(prisma, { userId: user.id });

      const res = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/channels`,
        headers: auth(user),
        payload: { channelType: "api" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("api channel is not available on your Starter plan. Please upgrade.");
      expect(await prisma.agentChannel.count()).toBe(0);
    });

    it("a second channel of the same type on one agent: the database refuses it (500, not mapped)", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      await prisma.agentChannel.create({ data: { agentId: agent.id, channelType: "web" } });

      const res = await app.inject({
        method: "POST",
        url: `/agents/${agent.id}/channels`,
        headers: auth(user),
        payload: { channelType: "web" },
      });

      expect(res.statusCode).toBe(500);
      expect(await prisma.agentChannel.count()).toBe(1);
    });

    it("a channel of the caller's other agent, through this agent: update and remove are 404, kept", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });
      const otherAgent = await createAgent(prisma, { userId: user.id });
      const channel = await prisma.agentChannel.create({ data: { agentId: otherAgent.id, channelType: "web", config: { a: 1 } } });

      const update = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}/channels/${channel.id}`,
        headers: auth(user),
        payload: { a: 2 },
      });
      const remove = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/channels/${channel.id}`, headers: auth(user) });

      expect(update.statusCode).toBe(404);
      expect(update.json().message).toBe("Channel not found");
      expect(remove.statusCode).toBe(404);
      expect(await prisma.agentChannel.findUnique({ where: { id: channel.id } })).toMatchObject({ config: { a: 1 } });
    });

    it("another user updates or removes a channel of my agent: 404, kept", async () => {
      const alice = await createUser(prisma);
      const bob = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: alice.id });
      const channel = await prisma.agentChannel.create({ data: { agentId: agent.id, channelType: "web", config: { a: 1 } } });

      const update = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}/channels/${channel.id}`,
        headers: auth(bob),
        payload: { a: 2 },
      });
      const remove = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/channels/${channel.id}`, headers: auth(bob) });

      expect(update.statusCode).toBe(404);
      expect(remove.statusCode).toBe(404);
      expect(await prisma.agentChannel.findUnique({ where: { id: channel.id } })).toMatchObject({ config: { a: 1 } });
    });
  });

  // RX-2 closed the route; the method stays on the service and is tested there.
  describe("AgentService.subscribe", () => {
    const service = () => moduleRef.get(AgentService);

    it("an unknown tier: 400", async () => {
      const user = await createUser(prisma);

      await expect(service().subscribe(user.id, "no-such-tier")).rejects.toMatchObject({
        status: 400,
        message: "Invalid plan tier",
      });
    });

    it("no subscription yet: creates an active one on the plan", async () => {
      const user = await createUser(prisma);
      const plan = await createPlan(prisma, { slug: "pro", priceMonthly: null });

      const result = await service().subscribe(user.id, "pro");

      expect(result.subscription).toMatchObject({ userId: user.id, planId: plan.id, status: "active", tokensUsed: "0" });
      expect(result.subscription.plan).toMatchObject({ id: plan.id, priceMonthly: null, maxTokensPerMonth: "1000000" });
      expect(await prisma.userSubscription.count()).toBe(1);
    });

    it("an active subscription: moves it to the plan and resets the usage", async () => {
      const { user } = await subscribed();
      await prisma.userSubscription.update({ where: { userId: user.id }, data: { messagesUsed: 7, tokensUsed: 70n } });
      const plan = await createPlan(prisma, { slug: "pro", priceMonthly: 150000 });

      const result = await service().subscribe(user.id, "pro");

      expect(result.subscription).toMatchObject({ planId: plan.id, messagesUsed: 0, tokensUsed: "0" });
      expect(result.subscription.plan).toMatchObject({ id: plan.id, priceMonthly: 150000 });
      expect(await prisma.userSubscription.count()).toBe(1);
    });

    it("an inactive subscription: the create hits the unique user id (P2002, not mapped), nothing changed", async () => {
      const { user, plan: oldPlan } = await subscribed({}, "canceled");
      await createPlan(prisma, { slug: "pro" });

      await expect(service().subscribe(user.id, "pro")).rejects.toMatchObject({ code: "P2002" });
      expect(await prisma.userSubscription.findUnique({ where: { userId: user.id } })).toMatchObject({
        planId: oldPlan.id,
        status: "canceled",
      });
    });
  });
});
