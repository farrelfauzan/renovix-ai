import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentRunController } from "./agent-run.controller";
import { AgentController } from "./agent.controller";
import { AgentService } from "../service/agent.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { WorkspaceController } from "../../workspace/controller/workspace.controller";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceMemberService } from "../../workspace/service/workspace-member.service";
import { WorkspaceInviteService } from "../../workspace/service/workspace-invite.service";
import { EmailJobService } from "../../email/service/email-job.service";
import { AgentRunService } from "../service/agent-run.service";
import { AgentRunMeterService } from "../service/agent-run-meter.service";
import { AgentToolService } from "../service/agent-tool.service";
import { AgentMemoryService } from "../service/agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { DocumentService } from "../../document/service/document.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { requestOverSocket } from "../../../../test/sse-client";
import { AgentLinkService } from "../service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-126: GET /agents/deleted and POST /agents/:id/restore (the owner of the agent's workspace, as DELETE), and the
// agents of a restored workspace (POST /workspaces/:id/restore, D316). Real controllers and services on the test
// database, fake provider. `all` is a client with nothing on PrismaService's default filter map, to read the rows as
// they are. These collaborators load ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../email/service/email-job.service", () => ({ EmailJobService: class {} }));

describe("RNX-126: the owner lists and restores deleted agents (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let all: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        controllers: [AgentRunController, AgentController, WorkspaceController],
        providers: [
          AgentRunService,
          AgentService,
          EntitlementService,
          WorkspaceService,
          WorkspaceMemberService,
          WorkspaceInviteService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: EmailJobService, useValue: {} },
          { provide: AgentToolService, useValue: { buildToolSchemasWithMcp: async () => [], cleanupMcpConnections: async () => undefined } },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
    all = PrismaService.create({});
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(async () => {
    await app?.close();
    await all?.$disconnect();
  });

  /** A user with a package (maxAgents as given), 1 credit and a session cookie. */
  const seedUser = async (maxAgents = 5) => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id, maxAgents, collaborationEnabled: true });
    await fundPaidWallet(prisma, user.id, "1");
    return { user, session: asSessionUser(user) };
  };

  const call = (method: "GET" | "POST" | "DELETE", url: string, session: { cookie: string }, payload?: object) =>
    app.inject({ method, url, headers: session, payload });
  const deletedIds = async (session: { cookie: string }) =>
    (await call("GET", "/agents/deleted", session)).json().map((a: { id: string }) => a.id);
  const liveIds = async (session: { cookie: string }) =>
    (await call("GET", "/agents", session)).json().map((a: { id: string }) => a.id).sort();
  const agentRows = () => all.agent.findMany({ orderBy: { id: "asc" } });
  const workspaceRows = () => all.workspace.findMany({ orderBy: { id: "asc" } });
  const postChat = (agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, { method: "POST", path: `/agents/${agentId}/chat`, headers: session, body: { message: "Hi" } });
  const enqueueReply = () =>
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });

  it("RNX-126: the list gives id, name, slug, deletedAt and purgeAt = deletedAt + 30 days, newest-deleted first", async () => {
    const { user, session } = await seedUser();
    const older = await createAgent(prisma, { userId: user.id, name: "Older", slug: "older" });
    const newer = await createAgent(prisma, { userId: user.id, name: "Newer", slug: "newer" });
    await createAgent(prisma, { userId: user.id });
    await all.agent.update({ where: { id: older.id }, data: { deletedAt: new Date("2026-11-01T10:00:00.000Z"), deletedById: user.id } });
    await all.agent.update({ where: { id: newer.id }, data: { deletedAt: new Date("2026-11-05T08:30:00.000Z"), deletedById: user.id } });

    const res = await call("GET", "/agents/deleted", session);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { id: newer.id, name: "Newer", slug: "newer", deletedAt: "2026-11-05T08:30:00.000Z", purgeAt: "2026-12-05T08:30:00.000Z" },
      { id: older.id, name: "Older", slug: "older", deletedAt: "2026-11-01T10:00:00.000Z", purgeAt: "2026-12-01T10:00:00.000Z" },
    ]);
  });

  it("RNX-126 AC1: after restore the agent is back in the list and the read with its tools and live knowledge base links; it has no integrations; a link to a still-deleted knowledge base stays hidden; it runs again", async () => {
    const { user, session } = await seedUser();
    const agent = await createAgent(prisma, { userId: user.id, name: "Bot", slug: "bot" });
    const tool = await prisma.agentTool.create({ data: { agentId: agent.id, toolType: "calculator" } });
    await prisma.agentIntegration.create({ data: { agentId: agent.id, provider: "notion", config: {}, scopes: [] } });
    const liveKb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "Live KB" } });
    const deletedKb = await prisma.knowledgeBase.create({ data: { userId: user.id, name: "Deleted KB" } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: liveKb.id } });
    await prisma.agentKnowledgeBase.create({ data: { agentId: agent.id, knowledgeBaseId: deletedKb.id } });
    await all.knowledgeBase.update({ where: { id: deletedKb.id }, data: { deletedAt: new Date(), deletedById: user.id } });
    expect((await call("DELETE", `/agents/${agent.id}`, session)).statusCode).toBe(204);
    expect(await deletedIds(session)).toEqual([agent.id]);

    const res = await call("POST", `/agents/${agent.id}/restore`, session);

    expect([res.statusCode, res.json()]).toEqual([200, { id: agent.id, name: "Bot", slug: "bot" }]);
    expect(await all.agent.findUniqueOrThrow({ where: { id: agent.id } })).toMatchObject({ deletedAt: null, deletedById: null });
    expect(await deletedIds(session)).toEqual([]);
    expect(await liveIds(session)).toEqual([agent.id]);
    const read = await call("GET", `/agents/${agent.id}`, session);
    expect(read.statusCode).toBe(200);
    expect(read.json().tools.map((t: { id: string }) => t.id)).toEqual([tool.id]);
    expect(read.json().integrations).toEqual([]);
    expect(await all.agentIntegration.count({ where: { agentId: agent.id } })).toBe(0);
    expect(read.json().knowledgeBases.map((k: { knowledgeBaseId: string }) => k.knowledgeBaseId)).toEqual([liveKb.id]);
    enqueueReply();
    const chat = await postChat(agent.id, session);
    expect([chat.statusCode, chat.contentType]).toEqual([200, "text/event-stream"]);
    expect(chat.body).toContain("Hello there");
  });

  it("RNX-126 AC2: another user's deleted agent is not listed and its restore answers 404; nothing changes", async () => {
    const { user: alice, session: aliceSession } = await seedUser();
    const { user: bob } = await seedUser();
    const bobsAgent = await createAgent(prisma, { userId: bob.id });
    await all.agent.update({ where: { id: bobsAgent.id }, data: { deletedAt: new Date(), deletedById: bob.id } });
    await createAgent(prisma, { userId: alice.id });
    const before = await agentRows();

    const listed = await deletedIds(aliceSession);
    const res = await call("POST", `/agents/${bobsAgent.id}/restore`, aliceSession);

    expect(listed).toEqual([]);
    expect([res.statusCode, res.json().message]).toEqual([404, "Agent not found"]);
    expect(await agentRows()).toEqual(before);
  });

  it("RNX-126 AC3: restore on a live agent answers 404; nothing changes", async () => {
    const { user, session } = await seedUser();
    const agent = await createAgent(prisma, { userId: user.id });
    const before = await agentRows();

    const res = await call("POST", `/agents/${agent.id}/restore`, session);

    expect([res.statusCode, res.json().message]).toEqual([404, "Agent not found"]);
    expect(await agentRows()).toEqual(before);
  });

  describe("RNX-126 AC4: the slug", () => {
    it("taken by a newer agent: the restored agent gets the first free suffix, the newer agent is unchanged", async () => {
      const { user, session } = await seedUser();
      const agent = await createAgent(prisma, { userId: user.id, slug: "bot" });
      expect((await call("DELETE", `/agents/${agent.id}`, session)).statusCode).toBe(204);
      const newer = await createAgent(prisma, { userId: user.id, slug: "bot" });
      await createAgent(prisma, { userId: user.id, slug: "bot-helper" });

      const res = await call("POST", `/agents/${agent.id}/restore`, session);

      expect([res.statusCode, res.json().slug]).toEqual([200, "bot-1"]);
      expect(await all.agent.findUniqueOrThrow({ where: { id: newer.id } })).toEqual(newer);
    });

    it("taken by an agent of a deleted workspace (it still holds the slug): the restored agent gets a suffix", async () => {
      const { user, session } = await seedUser();
      const agent = await createAgent(prisma, { userId: user.id, slug: "bot" });
      expect((await call("DELETE", `/agents/${agent.id}`, session)).statusCode).toBe(204);
      const hidden = await createWorkspace(prisma, { ownerId: user.id });
      await createAgent(prisma, { userId: user.id, slug: "bot", workspaceId: hidden.id });
      await all.workspace.update({ where: { id: hidden.id }, data: { deletedAt: new Date(), deletedById: user.id } });

      const res = await call("POST", `/agents/${agent.id}/restore`, session);

      expect([res.statusCode, res.json().slug]).toEqual([200, "bot-1"]);
    });

    it("free: the restored agent keeps its slug", async () => {
      const { user, session } = await seedUser();
      const agent = await createAgent(prisma, { userId: user.id, slug: "bot" });
      await createAgent(prisma, { userId: user.id, slug: "bot-1" });
      expect((await call("DELETE", `/agents/${agent.id}`, session)).statusCode).toBe(204);

      const res = await call("POST", `/agents/${agent.id}/restore`, session);

      expect([res.statusCode, res.json().slug]).toEqual([200, "bot"]);
    });
  });

  it("RNX-126 AC6: an agent restore that would take the user over maxAgents is refused with create's error; nothing changes", async () => {
    const { user, session } = await seedUser(1);
    const agent = await createAgent(prisma, { userId: user.id });
    expect((await call("DELETE", `/agents/${agent.id}`, session)).statusCode).toBe(204);
    await createAgent(prisma, { userId: user.id });
    const before = await agentRows();
    const create = await call("POST", "/agents", session, { name: "Third", systemPrompt: "x", model: "test-model" });

    const res = await call("POST", `/agents/${agent.id}/restore`, session);

    expect(create.statusCode).toBeGreaterThanOrEqual(400);
    expect([res.statusCode, res.json()]).toEqual([create.statusCode, create.json()]);
    expect(await agentRows()).toEqual(before);
  });

  it("RNX-126 (c): an agent of a deleted workspace is not listed and its restore answers 404; once the workspace is restored it stays deleted, is listed and can be restored", async () => {
    const { user, session } = await seedUser();
    const workspace = await createWorkspace(prisma, { ownerId: user.id });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } });
    const agent = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id });
    expect((await call("DELETE", `/agents/${agent.id}`, session)).statusCode).toBe(204);
    expect((await call("DELETE", `/workspaces/${workspace.id}`, session)).statusCode).toBe(200);
    const before = await agentRows();

    const listed = await deletedIds(session);
    const res = await call("POST", `/agents/${agent.id}/restore`, session);

    expect(listed).toEqual([]);
    expect([res.statusCode, res.json().message]).toEqual([404, "Agent not found"]);
    expect(await agentRows()).toEqual(before);
    expect((await call("POST", `/workspaces/${workspace.id}/restore`, session)).statusCode).toBe(200);
    expect(await deletedIds(session)).toEqual([agent.id]);
    expect((await call("POST", `/agents/${agent.id}/restore`, session)).statusCode).toBe(200);
  });

  describe("RNX-126: the agents of a restored workspace", () => {
    /** An owner (maxAgents as given) with one agent in the default workspace and a deleted workspace with two agents. */
    const seedDeletedWorkspace = async (maxAgents: number) => {
      const { user, session } = await seedUser(maxAgents);
      await createAgent(prisma, { userId: user.id });
      const workspace = await createWorkspace(prisma, { ownerId: user.id });
      await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "owner" } });
      const first = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id });
      const second = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id });
      expect((await call("DELETE", `/workspaces/${workspace.id}`, session)).statusCode).toBe(200);
      return { user, session, workspace, first, second };
    };

    it("RNX-126 AC8: they are back in the list and run again", async () => {
      const { session, workspace, first } = await seedDeletedWorkspace(5);
      expect((await postChat(first.id, session)).statusCode).toBe(404);

      expect((await call("POST", `/workspaces/${workspace.id}/restore`, session)).statusCode).toBe(200);

      expect(await liveIds(session)).toEqual(expect.arrayContaining([first.id]));
      enqueueReply();
      const chat = await postChat(first.id, session);
      expect([chat.statusCode, chat.contentType]).toEqual([200, "text/event-stream"]);
    });

    it("RNX-126 AC6 (D316): a workspace restore that would take the owner over maxAgents is refused as a whole with create's error; nothing changes", async () => {
      const { user, session, workspace } = await seedDeletedWorkspace(2);
      const beforeAgents = await agentRows();
      const beforeWorkspaces = await workspaceRows();

      const res = await call("POST", `/workspaces/${workspace.id}/restore`, session);

      expect(await agentRows()).toEqual(beforeAgents);
      expect(await workspaceRows()).toEqual(beforeWorkspaces);
      await createAgent(prisma, { userId: user.id });
      const create = await call("POST", "/agents", session, { name: "Third", systemPrompt: "x", model: "test-model" });
      expect(create.statusCode).toBeGreaterThanOrEqual(400);
      expect([res.statusCode, res.json()]).toEqual([create.statusCode, create.json()]);
    });

    it("RNX-126 AC6 (D316, control): exactly at maxAgents the workspace is restored", async () => {
      const { session, workspace } = await seedDeletedWorkspace(3);

      const res = await call("POST", `/workspaces/${workspace.id}/restore`, session);

      expect(res.statusCode).toBe(200);
    });

    it("RNX-126 AC6 (D316): an agent deleted on its own before the workspace is not counted, and stays deleted", async () => {
      const { user, session, workspace, second } = await seedDeletedWorkspace(2);
      await all.agent.update({ where: { id: second.id }, data: { deletedAt: new Date(), deletedById: user.id } });

      const res = await call("POST", `/workspaces/${workspace.id}/restore`, session);

      expect(res.statusCode).toBe(200);
      expect(await all.agent.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ deletedAt: expect.any(Date) });
      expect(await deletedIds(session)).toEqual([second.id]);
    });
  });
});
