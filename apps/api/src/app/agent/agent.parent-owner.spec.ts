import { Logger } from "@nestjs/common";
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

// RX-112: parentAgentId must be one of the caller's own parent agents and only
// a sub-agent can have one; the agent list and detail only show sub-agents
// owned by the parent's owner. Real controller and service, test database.
jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

process.env.JWT_SECRET = "rx112-test-jwt-secret";

describe("RX-112: parentAgentId belongs to the caller (Fastify, test database)", () => {
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
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app?.close());

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  /** Alice (subscribed) and Bob, each with a parent agent. */
  const setup = async () => {
    const plan = await createPlan(prisma, { maxAgents: 50 });
    const alice = await createUser(prisma);
    const bob = await createUser(prisma);
    await createSubscription(prisma, { userId: alice.id, planId: plan.id });
    const aliceParent = await createAgent(prisma, { userId: alice.id, agentType: "parent" });
    const bobParent = await createAgent(prisma, { userId: bob.id, agentType: "parent" });
    return { alice, bob, aliceParent, bobParent };
  };

  const createAs = (user: { id: string; email: string }, payload: object) =>
    app.inject({
      method: "POST",
      url: "/agents",
      headers: auth(user),
      payload: { name: "New agent", systemPrompt: "prompt", model: "test-model", ...payload },
    });

  const patchAs = (user: { id: string; email: string }, id: string, payload: object) =>
    app.inject({ method: "PATCH", url: `/agents/${id}`, headers: auth(user), payload });

  describe("POST /agents", () => {
    it.each([["sub_agent"], ["standalone"], ["parent"], [undefined]])(
      "refuses another user's parent agent as parentAgentId (agentType %s): 400, nothing stored",
      async (agentType) => {
        const { alice, bobParent } = await setup();

        const res = await createAs(alice, { agentType, parentAgentId: bobParent.id });

        expect(res.statusCode).toBe(400);
        expect(await prisma.agent.count({ where: { userId: alice.id } })).toBe(1);
        expect(await prisma.agent.count({ where: { parentAgentId: bobParent.id } })).toBe(0);
      },
    );

    it.each([["standalone"], ["parent"], [undefined]])(
      "refuses parentAgentId on a non-sub-agent even with the caller's own parent (agentType %s): 400",
      async (agentType) => {
        const { alice, aliceParent } = await setup();

        const res = await createAs(alice, { agentType, parentAgentId: aliceParent.id });

        expect(res.statusCode).toBe(400);
        expect(await prisma.agent.count({ where: { parentAgentId: aliceParent.id } })).toBe(0);
      },
    );

    it("refuses the caller's own non-parent agent as parentAgentId: 400", async () => {
      const { alice } = await setup();
      const standalone = await createAgent(prisma, { userId: alice.id });

      const res = await createAs(alice, { agentType: "sub_agent", parentAgentId: standalone.id });

      expect(res.statusCode).toBe(400);
      expect(await prisma.agent.count({ where: { parentAgentId: standalone.id } })).toBe(0);
    });

    it("creates a sub-agent under the caller's own parent agent (positive control)", async () => {
      const { alice, aliceParent } = await setup();

      const res = await createAs(alice, { agentType: "sub_agent", parentAgentId: aliceParent.id });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ agentType: "sub_agent", parentAgentId: aliceParent.id });
    });
  });

  describe("PATCH /agents/:id", () => {
    it.each([
      ["sub_agent", { agentType: "sub_agent" }],
      ["standalone", { agentType: "standalone" }],
      ["left out (standalone agent)", {}],
    ])(
      "refuses another user's parent agent as parentAgentId (agentType %s): 400, agent unchanged",
      async (_label, extra) => {
        const { alice, bobParent } = await setup();
        const agent = await createAgent(prisma, { userId: alice.id });

        const res = await patchAs(alice, agent.id, { ...extra, parentAgentId: bobParent.id });

        expect(res.statusCode).toBe(400);
        expect(await prisma.agent.findUnique({ where: { id: agent.id } })).toMatchObject({
          agentType: "standalone",
          parentAgentId: null,
        });
      },
    );

    it("refuses another user's parent agent for an existing sub-agent (agentType left out): 400", async () => {
      const { alice, aliceParent, bobParent } = await setup();
      const sub = await createAgent(prisma, {
        userId: alice.id,
        agentType: "sub_agent",
        parentAgentId: aliceParent.id,
      });

      const res = await patchAs(alice, sub.id, { parentAgentId: bobParent.id });

      expect(res.statusCode).toBe(400);
      expect((await prisma.agent.findUnique({ where: { id: sub.id } }))?.parentAgentId).toBe(aliceParent.id);
    });

    it.each([
      ["standalone", { agentType: "standalone" }],
      ["parent", { agentType: "parent" }],
      ["left out (standalone agent)", {}],
    ])(
      "refuses parentAgentId on a non-sub-agent even with the caller's own parent (agentType %s): 400",
      async (_label, extra) => {
        const { alice, aliceParent } = await setup();
        const agent = await createAgent(prisma, { userId: alice.id });

        const res = await patchAs(alice, agent.id, { ...extra, parentAgentId: aliceParent.id });

        expect(res.statusCode).toBe(400);
        expect((await prisma.agent.findUnique({ where: { id: agent.id } }))?.parentAgentId).toBeNull();
      },
    );

    it("refuses the caller's own non-parent agent as parentAgentId: 400", async () => {
      const { alice } = await setup();
      const standalone = await createAgent(prisma, { userId: alice.id });
      const agent = await createAgent(prisma, { userId: alice.id });

      const res = await patchAs(alice, agent.id, { agentType: "sub_agent", parentAgentId: standalone.id });

      expect(res.statusCode).toBe(400);
      expect((await prisma.agent.findUnique({ where: { id: agent.id } }))?.parentAgentId).toBeNull();
    });

    it("links to and unlinks from the caller's own parent agent; explicit null stays allowed (positive control)", async () => {
      const { alice, aliceParent } = await setup();
      const agent = await createAgent(prisma, { userId: alice.id });

      const link = await patchAs(alice, agent.id, { agentType: "sub_agent", parentAgentId: aliceParent.id });
      expect(link.statusCode).toBe(200);
      expect(link.json()).toMatchObject({ agentType: "sub_agent", parentAgentId: aliceParent.id });

      const unlink = await patchAs(alice, agent.id, { agentType: "standalone", parentAgentId: null });
      expect(unlink.statusCode).toBe(200);
      expect(unlink.json()).toMatchObject({ agentType: "standalone", parentAgentId: null });
    });

    it("clears parentAgentId when the agent stops being a sub-agent", async () => {
      const { alice, aliceParent } = await setup();
      const sub = await createAgent(prisma, {
        userId: alice.id,
        agentType: "sub_agent",
        parentAgentId: aliceParent.id,
      });

      const res = await patchAs(alice, sub.id, { agentType: "standalone" });

      expect(res.statusCode).toBe(200);
      expect((await prisma.agent.findUnique({ where: { id: sub.id } }))?.parentAgentId).toBeNull();
    });
  });

  describe("agent list and detail", () => {
    /** Bob's parent with Bob's own sub-agent and a foreign one written straight to the database. */
    const seedForeignSub = async () => {
      const { alice, bob, bobParent } = await setup();
      const ownSub = await createAgent(prisma, {
        userId: bob.id,
        name: "Bob own helper",
        agentType: "sub_agent",
        parentAgentId: bobParent.id,
      });
      const foreignSub = await createAgent(prisma, {
        userId: alice.id,
        name: "Alice foreign helper",
        agentType: "sub_agent",
        parentAgentId: bobParent.id,
      });
      return { alice, bob, bobParent, ownSub, foreignSub };
    };

    it("GET /agents/:id leaves out a foreign sub-agent and logs a warning with ids only", async () => {
      const { bob, bobParent, ownSub, foreignSub } = await seedForeignSub();
      const warn = jest.spyOn(Logger.prototype, "warn");

      const res = await app.inject({ method: "GET", url: `/agents/${bobParent.id}`, headers: auth(bob) });

      expect(res.statusCode).toBe(200);
      expect(res.json().subAgents.map((s: { id: string }) => s.id)).toEqual([ownSub.id]);
      const warnings = warn.mock.calls.map(([msg]) => String(msg)).filter((m) => m.includes("[security]"));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(foreignSub.id);
      expect(warnings[0]).toContain(bobParent.id);
      expect(warnings[0]).not.toContain(foreignSub.name);
    });

    it("GET /agents leaves out a foreign sub-agent", async () => {
      const { bob, bobParent, ownSub } = await seedForeignSub();

      const res = await app.inject({ method: "GET", url: "/agents", headers: auth(bob) });

      expect(res.statusCode).toBe(200);
      const parent = res.json().find((a: { id: string }) => a.id === bobParent.id);
      expect(parent.subAgents.map((s: { id: string }) => s.id)).toEqual([ownSub.id]);
    });
  });
});
