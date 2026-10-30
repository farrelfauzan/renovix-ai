import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentController } from "./agent.controller";
import { AgentLinkController } from "./agent-link.controller";
import { AgentService } from "../service/agent.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { AgentLinkService } from "../service/agent-link.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createApiKey, createPackageSnapshot, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";
import { cheapestTierRegistry } from "../../../../test/cheapest-tier-registry";

// RNX-118 (PRD 10, D81; replaces RX-112's parent-owner suite): an agent's links ("Can call") are listed, added and
// removed by the workspace owner of the agent only (RNX-203: workspace.ownerId). RNX-260 (D259): a collaborator
// inside the workspace gets 403; another user, and a member row of a workspace without collaboration (Starter, Pro:
// not inside, D64), get 404 (was 403); another user's API key gets 403 from the access guard. The links stay as they
// were; both agents must be in one workspace (403), and an agent never links to itself (400). Run on a Starter, a Pro
// and an Enterprise owner; collaborators exist only on Enterprise (D64), so on Starter and Pro the member row is
// written straight to the database. Real controllers and services, test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

type User = { id: string; email: string };

describe("RNX-118: agent links (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController, AgentLinkController],
      providers: [
        AgentService,
        EntitlementService,
        AgentRunPolicyService,
        AgentLinkService,
        WorkspaceService,
        WorkspaceQuotaService,
        { provide: ProviderRouter, useValue: {} },
        { provide: ModelRegistryService, useValue: cheapestTierRegistry },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app?.close());

  const bearer = (user: User) => asSessionUser(user);
  const apiKey = (key: string) => ({ authorization: `Bearer ${key}` });
  const links = () => prisma.agentLink.findMany({ select: { callerAgentId: true, calleeAgentId: true } });

  describe.each(["starter", "pro", "enterprise"])("on a %s workspace", (planSlug) => {
    /**
     * The owner's workspace W (on this plan) with agents A and B, an admin member of W (the collaborator), another
     * subscribed user with an API key, and agents of another workspace of the owner and of the other user.
     */
    const setup = async () => {
      const plan = await createPlan(prisma, { slug: planSlug, maxAgents: 50 });
      const owner = await createUser(prisma);
      const collaborator = await createUser(prisma);
      const outsiderUser = await createUser(prisma);
      const outsider = { ...outsiderUser, apiKey: await createApiKey(prisma, outsiderUser.id) };
      await createSubscription(prisma, { userId: owner.id, planId: plan.id });
      await createSubscription(prisma, { userId: outsider.id, planId: plan.id });
      // RNX-76 B3 (D297): only the Enterprise owner's package enables collaboration.
      await createPackageSnapshot(prisma, { userId: owner.id, maxAgents: 50, collaborationEnabled: planSlug === "enterprise" });
      await createPackageSnapshot(prisma, { userId: outsider.id, maxAgents: 50 });
      const workspace = await createWorkspace(prisma, { ownerId: owner.id });
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: collaborator.id, role: "admin", status: "active" },
      });
      const a = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: "Agent A" });
      const b = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, name: "Agent B" });
      const ownersOtherWorkspace = await createWorkspace(prisma, { ownerId: owner.id });
      const ownersOtherAgent = await createAgent(prisma, { userId: owner.id, workspaceId: ownersOtherWorkspace.id });
      const outsidersAgent = await createAgent(prisma, { userId: outsider.id });
      return { owner, collaborator, outsider, a, b, ownersOtherAgent, outsidersAgent };
    };
    type Seeded = Awaited<ReturnType<typeof setup>>;

    const post = (headers: Record<string, string>, agentId: string, payload: object) =>
      app.inject({ method: "POST", url: `/agents/${agentId}/links`, headers, payload });
    const remove = (headers: Record<string, string>, agentId: string, calleeId: string) =>
      app.inject({ method: "DELETE", url: `/agents/${agentId}/links/${calleeId}`, headers });

    it("the owner links A to B: 201, stored, and listed with B's public fields (positive control)", async () => {
      const { owner, a, b } = await setup();

      const res = await post(bearer(owner), a.id, { calleeAgentId: b.id });
      const list = await app.inject({ method: "GET", url: `/agents/${a.id}/links`, headers: bearer(owner) });

      expect(res.statusCode).toBe(201);
      expect(await links()).toEqual([{ callerAgentId: a.id, calleeAgentId: b.id }]);
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([
        expect.objectContaining({
          calleeAgentId: b.id,
          calleeAgent: { id: b.id, name: "Agent B", description: null, avatar: null, status: "draft" },
        }),
      ]);
    });

    it("the owner links A to A: 400, nothing stored", async () => {
      const { owner, a } = await setup();

      const res = await post(bearer(owner), a.id, { calleeAgentId: a.id });

      expect(res.statusCode).toBe(400);
      expect(await links()).toEqual([]);
    });

    it.each([
      ["another workspace of the owner", "ownersOtherAgent"],
      ["another user's workspace", "outsidersAgent"],
    ] as const)("the owner links A to an agent of %s: 403, nothing stored", async (_label, key) => {
      const seeded = await setup();

      const res = await post(bearer(seeded.owner), seeded.a.id, { calleeAgentId: seeded[key].id });

      expect(res.statusCode).toBe(403);
      expect(await links()).toEqual([]);
    });

    it.each([[{}], [{ calleeAgentId: "not-a-uuid" }], [{ calleeAgentId: 42 }]])(
      "a body that is not { calleeAgentId: uuid } (%j): 400, nothing stored",
      async (payload) => {
        const { owner, a } = await setup();

        const res = await post(bearer(owner), a.id, payload);

        expect(res.statusCode).toBe(400);
        expect(await links()).toEqual([]);
      },
    );

    // RNX-260 (D259): 403 inside the workspace (the admin row is a collaborator only where the plan allows it, D64),
    // 404 outside it.
    const insideStatus = planSlug === "enterprise" ? 403 : 404;
    const intruders = [
      ["a collaborator (admin member of the workspace)", (s: Seeded) => bearer(s.collaborator), insideStatus],
      ["another user", (s: Seeded) => bearer(s.outsider), 404],
      // an API key is refused by the access guard before the service (the link routes are jwt/session only): 403
      ["another user's API key", (s: Seeded) => apiKey(s.outsider.apiKey), 403],
    ] as const;

    it.each(intruders)("%s adding a link on A: refused, no link stored", async (_label, headersOf, expected) => {
      const seeded = await setup();

      const res = await post(headersOf(seeded), seeded.a.id, { calleeAgentId: seeded.b.id });

      expect(res.statusCode).toBe(expected);
      expect(await links()).toEqual([]);
    });

    it.each(intruders)("%s removing A's link: refused, the link kept", async (_label, headersOf, expected) => {
      const seeded = await setup();
      await prisma.agentLink.create({ data: { callerAgentId: seeded.a.id, calleeAgentId: seeded.b.id } });

      const res = await remove(headersOf(seeded), seeded.a.id, seeded.b.id);

      expect(res.statusCode).toBe(expected);
      expect(await links()).toEqual([{ callerAgentId: seeded.a.id, calleeAgentId: seeded.b.id }]);
    });

    it.each(intruders)("%s listing A's links: refused", async (_label, headersOf, expected) => {
      const seeded = await setup();
      await prisma.agentLink.create({ data: { callerAgentId: seeded.a.id, calleeAgentId: seeded.b.id } });

      const res = await app.inject({ method: "GET", url: `/agents/${seeded.a.id}/links`, headers: headersOf(seeded) });

      expect(res.statusCode).toBe(expected);
      expect(res.body).not.toContain(seeded.b.id);
    });

    it("the owner removes A's link: 204, the link gone (positive control)", async () => {
      const { owner, a, b } = await setup();
      await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: b.id } });

      const res = await remove(bearer(owner), a.id, b.id);

      expect(res.statusCode).toBe(204);
      expect(await links()).toEqual([]);
    });
  });

  describe("the removed agentType and parentAgentId (the current front end still sends them)", () => {
    const subscribed = async () => {
      const user = await createUser(prisma);
      const plan = await createPlan(prisma, { maxAgents: 50 });
      await createSubscription(prisma, { userId: user.id, planId: plan.id });
      await createPackageSnapshot(prisma, { userId: user.id, maxAgents: 50 });
      return user;
    };

    it.each([
      ["agentType: parent", (_parentId: string) => ({ agentType: "parent" })],
      ["agentType: sub_agent with parentAgentId", (parentId: string) => ({ agentType: "sub_agent", parentAgentId: parentId })],
      ["parentAgentId alone", (parentId: string) => ({ parentAgentId: parentId })],
    ] as const)("POST /agents with %s: 201, the fields ignored, no link stored", async (_label, extra) => {
      const user = await subscribed();
      const existing = await createAgent(prisma, { userId: user.id });

      const res = await app.inject({
        method: "POST",
        url: "/agents",
        headers: bearer(user),
        payload: { name: "New agent", systemPrompt: "prompt", model: "test-model", ...extra(existing.id) },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).not.toHaveProperty("agentType");
      expect(res.json()).not.toHaveProperty("parentAgentId");
      expect(await prisma.agent.count({ where: { userId: user.id } })).toBe(2);
      expect(await links()).toEqual([]);
    });

    it("PATCH /agents/:id with agentType and parentAgentId: 200, the fields ignored, no link stored", async () => {
      const user = await subscribed();
      const parent = await createAgent(prisma, { userId: user.id });
      const agent = await createAgent(prisma, { userId: user.id });

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${agent.id}`,
        headers: bearer(user),
        payload: { name: "Renamed", agentType: "sub_agent", parentAgentId: parent.id },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: "Renamed" });
      expect(res.json()).not.toHaveProperty("parentAgentId");
      expect(await links()).toEqual([]);
    });
  });
});
