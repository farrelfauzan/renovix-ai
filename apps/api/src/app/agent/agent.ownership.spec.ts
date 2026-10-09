import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";
import { ProviderRouter } from "../providers/provider-router";
import { WorkspaceService } from "../workspace/workspace.service";
import { WorkspaceQuotaService } from "../workspace/workspace-quota.service";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
} from "../../../test/factories";

// RX-15 characterization: agent ownership through the real controller and
// service (CombinedAuthGuard JWT path, test database). The routes used here
// never call a model, so ProviderRouter is an empty stub.
jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

process.env.JWT_SECRET = "rx15-test-jwt-secret";

describe("Agents: ownership (RX-15, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentController],
      // RX-113: attaching a workspace knowledge base checks the workspace role
      providers: [AgentService, WorkspaceService, WorkspaceQuotaService, { provide: ProviderRouter, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

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

  // HOLE (RX-15): PATCH /agents/:id only checks parentAgentId against the
  // caller's agents when the agent ends up as "sub_agent". With agentType left
  // out on a standalone agent, Bob can point his agent at Alice's parent agent;
  // it then shows up in Alice's subAgents and is offered to her agent for
  // delegation (agent-run.service / channel-chat.service load subAgents by parentAgentId).
  test.failing(
    "another user cannot hang their agent under someone else's parent agent (PATCH parentAgentId)",
    async () => {
      const { alice, bob } = await setup();
      const aliceParent = await createAgent(prisma, { userId: alice.id, agentType: "parent" });
      const bobAgent = await createAgent(prisma, { userId: bob.id });

      const res = await app.inject({
        method: "PATCH",
        url: `/agents/${bobAgent.id}`,
        headers: auth(bob),
        payload: { parentAgentId: aliceParent.id },
      });

      const aliceView = await app.inject({
        method: "GET",
        url: `/agents/${aliceParent.id}`,
        headers: auth(alice),
      });
      expect(aliceView.json().subAgents).toEqual([]);
      expect([400, 404]).toContain(res.statusCode);
    },
  );

  // HOLE (RX-15): same gap on create. POST /agents only checks parentAgentId
  // when agentType is "sub_agent"; with agentType "standalone" (the default)
  // the new agent is created under Alice's parent agent.
  test.failing(
    "another user cannot create an agent under someone else's parent agent (POST parentAgentId)",
    async () => {
      const { alice, bob } = await setup();
      const plan = await createPlan(prisma);
      await createSubscription(prisma, { userId: bob.id, planId: plan.id });
      const aliceParent = await createAgent(prisma, { userId: alice.id, agentType: "parent" });

      const res = await app.inject({
        method: "POST",
        url: "/agents",
        headers: auth(bob),
        payload: {
          name: "Bob helper",
          systemPrompt: "Bob's prompt",
          model: "test-model",
          parentAgentId: aliceParent.id,
        },
      });

      expect(await prisma.agent.count({ where: { parentAgentId: aliceParent.id } })).toBe(0);
      expect([400, 404]).toContain(res.statusCode);
    },
  );
});
