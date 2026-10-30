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
import {
  createAgent,
  createPackageSnapshot,
  createPlan,
  createSubscription,
  createUser,
} from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";
import { cheapestTierRegistry } from "../../../../test/cheapest-tier-registry";

// RX-15 characterization: agent ownership through the real controller and
// service (CombinedAuthGuard session path, test database). The routes used here
// never call a model, so ProviderRouter is an empty stub.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

describe("Agents: ownership (RX-15, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController, AgentLinkController],
      // RX-113: attaching a workspace knowledge base checks the workspace role
      providers: [AgentService, EntitlementService, AgentRunPolicyService, AgentLinkService, WorkspaceService, WorkspaceQuotaService, { provide: ProviderRouter, useValue: {} }, { provide: ModelRegistryService, useValue: cheapestTierRegistry }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => asSessionUser(user);

  const setup = async () => {
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: alice.id, name: "Alice agent" });
    return { alice, bob, agent };
  };

  it.each([
    ["GET", "/agents"],
    ["GET", "/agents/00000000-0000-4000-8000-000000000000"],
    ["PATCH", "/agents/00000000-0000-4000-8000-000000000000"],
    ["DELETE", "/agents/00000000-0000-4000-8000-000000000000"],
  ] as const)("not signed in: %s %s is 401", async (method, url) => {
    const res = await app.inject({ method, url, payload: method === "PATCH" ? {} : undefined });

    expect(res.statusCode).toBe(401);
  });

  it("owner can read and change their agent (positive control)", async () => {
    const { alice, agent } = await setup();

    const read = await app.inject({ method: "GET", url: `/agents/${agent.id}`, headers: auth(alice) });
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(agent.id);

    const update = await app.inject({
      method: "PATCH",
      url: `/agents/${agent.id}`,
      headers: auth(alice),
      payload: { description: "changed by owner" },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().description).toBe("changed by owner");
  });

  it("another user cannot read it: GET /agents/:id is 404 and the list leaves it out", async () => {
    const { bob, agent } = await setup();

    const read = await app.inject({ method: "GET", url: `/agents/${agent.id}`, headers: auth(bob) });
    expect(read.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: "/agents", headers: auth(bob) });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
  });

  it.each([
    ["PATCH", "", { description: "changed by bob" }],
    ["PATCH", "/status", { status: "archived" }],
    ["POST", "/publish", undefined],
    ["DELETE", "", undefined],
  ] as const)("another user cannot change it: %s /agents/:id%s is 404, agent unchanged", async (method, suffix, payload) => {
    const { bob, agent } = await setup();

    const res = await app.inject({
      method,
      url: `/agents/${agent.id}${suffix}`,
      headers: auth(bob),
      payload,
    });

    expect(res.statusCode).toBe(404);
    const after = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(after).toMatchObject({ description: null, status: "draft", isPublic: false });
  });

  it("another user cannot attach a tool to it (verifyOwnership: 404)", async () => {
    const { bob, agent } = await setup();

    const res = await app.inject({
      method: "POST",
      url: `/agents/${agent.id}/tools`,
      headers: auth(bob),
      payload: { toolType: "calculator" },
    });

    expect(res.statusCode).toBe(404);
    expect(await prisma.agentTool.count({ where: { agentId: agent.id } })).toBe(0);
  });

  // Was HOLE (RX-15), fixed by RX-112 (parentAgentId); RNX-118 replaced parent and sub-agents with links. Bob could
  // point his agent at Alice's parent agent, which then offered it to her agent. Now a link is made by the workspace
  // owner of the calling agent, to an agent of the same workspace. RNX-260 (D259): 404 outside the workspace (was 403).
  it("another user cannot make their agent callable by someone else's agent (POST /agents/:id/links on Alice's agent)", async () => {
    const { alice, bob, agent } = await setup();
    const bobAgent = await createAgent(prisma, { userId: bob.id });

    const res = await app.inject({
      method: "POST",
      url: `/agents/${agent.id}/links`,
      headers: auth(bob),
      payload: { calleeAgentId: bobAgent.id },
    });

    expect(res.statusCode).toBe(404);
    expect(await prisma.agentLink.count()).toBe(0);
    expect(alice.id).not.toBe(bob.id);
  });

  // Was HOLE (RX-15), fixed by RX-112: the same gap on create (POST /agents with parentAgentId). RNX-118: the field
  // is ignored now, and linking his own agent to Alice's agent is refused (another workspace).
  it("another user cannot link their own agent to someone else's agent (POST parentAgentId, then POST /agents/:id/links)", async () => {
    const { bob, agent } = await setup();
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: bob.id, planId: plan.id });
    await createPackageSnapshot(prisma, { userId: bob.id });

    const created = await app.inject({
      method: "POST",
      url: "/agents",
      headers: auth(bob),
      payload: { name: "Bob helper", systemPrompt: "Bob's prompt", model: "test-model", parentAgentId: agent.id },
    });
    const linked = await app.inject({
      method: "POST",
      url: `/agents/${created.json().id}/links`,
      headers: auth(bob),
      payload: { calleeAgentId: agent.id },
    });

    expect(created.statusCode).toBe(201);
    expect(linked.statusCode).toBe(403);
    expect(await prisma.agentLink.count()).toBe(0);
  });
});
