import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
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

// RNX-117: every agent lives in a workspace. Create and clone put the agent in the caller's default workspace,
// created on the first agent of an account that has none yet. Real controller and service, test database.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

process.env.JWT_SECRET = "rnx117-test-jwt-secret";

describe("RNX-117: agents go into the caller's default workspace (Fastify, test database)", () => {
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

  const auth = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`,
  });

  /** A subscribed user with no workspace at all (an account from before RNX-117). */
  const subscribedUser = async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, { maxAgents: 10 });
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    return user;
  };

  const defaultsOf = (ownerId: string) => prisma.workspace.findMany({ where: { ownerId, isDefault: true }, include: { members: true } });

  const newAgent = { name: "My Agent", systemPrompt: "prompt", model: "test-model" };

  it("POST /agents by an account with no default workspace creates one and puts the agent in it", async () => {
    const user = await subscribedUser();
    expect(await prisma.workspace.count()).toBe(0);

    const res = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });

    expect(res.statusCode).toBe(201);
    const defaults = await defaultsOf(user.id);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].members).toEqual([expect.objectContaining({ userId: user.id, role: "owner", status: "active" })]);
    expect(res.json().workspaceId).toBe(defaults[0].id);
  });

  it("POST /agents by an account with a default workspace and another workspace uses the default one, creates no workspace", async () => {
    const user = await subscribedUser();
    const other = await createWorkspace(prisma, { ownerId: user.id });
    const existing = await ensureDefaultWorkspace(prisma, user.id);

    const first = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });
    const second = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });

    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect([first.json().workspaceId, second.json().workspaceId]).toEqual([existing.id, existing.id]);
    expect((await prisma.workspace.findMany()).map((w) => w.id).sort()).toEqual([existing.id, other.id].sort());
  });

  it("POST /agents/clone/:templateId puts the clone in the caller's default workspace, not the template owner's", async () => {
    const owner = await createUser(prisma);
    const template = await createAgent(prisma, { userId: owner.id, isPublic: true, status: "active" });
    const user = await subscribedUser();

    const res = await app.inject({ method: "POST", url: `/agents/clone/${template.id}`, headers: auth(user) });

    expect(res.statusCode).toBe(201);
    const defaults = await defaultsOf(user.id);
    expect(defaults).toHaveLength(1);
    expect(res.json().workspaceId).toBe(defaults[0].id);
    expect(res.json().workspaceId).not.toBe(template.workspaceId);
  });

  it("a refused create (no subscription: 403) creates no workspace", async () => {
    const user = await createUser(prisma);

    const res = await app.inject({ method: "POST", url: "/agents", headers: auth(user), payload: newAgent });

    expect(res.statusCode).toBe(403);
    expect(await prisma.workspace.count()).toBe(0);
  });
});
