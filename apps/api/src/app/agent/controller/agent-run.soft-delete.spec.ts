import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentRunController } from "./agent-run.controller";
import { AgentController } from "./agent.controller";
import { AgentService } from "../service/agent.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
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
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { requestOverSocket } from "../../../../test/sse-client";
import { AgentLinkService } from "../service/agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { AgentRunPolicyService } from "../service/agent-run-policy.service";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-124: the owner's chat route (POST /agents/:id/chat; there is no other owner chat route, the SSE route runs
// AgentRunService.chat inside) does not run a deleted agent: 404 before the SSE headers, no model call, no run,
// message, reservation or ledger entry. The run routes of a deleted agent answer as for no agent. Its usage rows
// (ledger entries with its agentId, usage logs) stay as they were. Real controllers and services on the test database,
// fake provider. These collaborators load ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

describe("RNX-124: a deleted agent does not run and its runs are hidden (Fastify, test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const cleanupMcpConnections = jest.fn(async () => undefined);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        controllers: [AgentRunController, AgentController],
        providers: [
          AgentRunService,
          AgentService,
          EntitlementService,
          WorkspaceService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async () => [],
              cleanupMcpConnections,
            },
          },
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
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    cleanupMcpConnections.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    // Standard 1 / 1 / 1: a call costs its token count in micro-credits; the first call's max_tokens alone is 0.004096.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** A subscribed user funded with 1 credit, with an agent and a session cookie. */
  const seed = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id });
    return { user, agent, session: asSessionUser(user) };
  };

  const postChat = (agentId: string, session: { cookie: string }) =>
    requestOverSocket(app, { method: "POST", path: `/agents/${agentId}/chat`, headers: session, body: { message: "Hi" } });

  const deleteAgent = (agentId: string, session: { cookie: string }) =>
    app.inject({ method: "DELETE", url: `/agents/${agentId}`, headers: session });

  /** Rows a message writes, and the ledger. */
  const writtenRows = async () => ({
    runs: await prisma.agentRun.count(),
    messages: await prisma.agentMessage.count(),
    reservations: await prisma.creditReservation.count(),
    ledgerEntries: await prisma.creditLedgerEntry.count(),
  });

  it("RNX-124 AC3: owner chat on a deleted agent → HTTP 404 before the SSE headers; no model call, run, message, reservation or ledger entry", async () => {
    const { agent, session } = await seed();
    expect((await deleteAgent(agent.id, session)).statusCode).toBe(204);
    const before = await writtenRows();

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType]).toEqual([404, expect.stringContaining("application/json")]);
    expect(fake.requests).toHaveLength(0);
    expect(await writtenRows()).toEqual({ ...before, runs: 0, messages: 0, reservations: 0 });
    expect(cleanupMcpConnections).not.toHaveBeenCalled();
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-124 AC3 (control): the same agent with its deletedAt cleared runs again → 200 SSE with the reply", async () => {
    const { agent, session } = await seed();
    await deleteAgent(agent.id, session);
    await prisma.agent.updateMany({ where: { id: agent.id }, data: { deletedAt: null, deletedById: null } });
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType]).toEqual([200, "text/event-stream"]);
    expect(res.body).toContain("Hello there");
  });

  it("RNX-125 AC8: an agent in a deleted workspace: owner chat (the SSE route) → 404 before the SSE headers, no model call or row written; absent from GET /agents and GET /agents/public, GET /agents/:id 404; back once the marker is cleared", async () => {
    const { user, agent: other, session } = await seed();
    const workspace = await createWorkspace(prisma, { ownerId: user.id });
    const agent = await createAgent(prisma, { userId: user.id, workspaceId: workspace.id, status: "active", isPublic: true });
    await prisma.workspace.update({ where: { id: workspace.id }, data: { deletedAt: new Date(), deletedById: user.id } });
    const before = await writtenRows();
    const ids = async (url: string) => (await app.inject({ method: "GET", url, headers: session })).json().map((a: { id: string }) => a.id);

    const res = await postChat(agent.id, session);

    expect([res.statusCode, res.contentType]).toEqual([404, expect.stringContaining("application/json")]);
    expect(res.body).toContain("Agent not found");
    expect(fake.requests).toHaveLength(0);
    expect(await writtenRows()).toEqual(before);
    expect(await ids("/agents")).toEqual([other.id]);
    expect(await ids("/agents/public")).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/agents/${agent.id}`, headers: session })).statusCode).toBe(404);
    await prisma.workspace.update({ where: { id: workspace.id }, data: { deletedAt: null, deletedById: null } });
    expect((await ids("/agents")).sort()).toEqual([other.id, agent.id].sort());
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const again = await postChat(agent.id, session);
    expect([again.statusCode, again.contentType]).toEqual([200, "text/event-stream"]);
  });

  describe("RNX-124 AC4: the run routes of a deleted agent", () => {
    /** One finished chat of the agent, so it has a run with two messages. */
    const seedWithRun = async () => {
      const seeded = await seed();
      fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });
      await postChat(seeded.agent.id, seeded.session);
      const run = await prisma.agentRun.findFirstOrThrow({ where: { agentId: seeded.agent.id } });
      return { ...seeded, run };
    };

    it("list its runs, read or delete its run → 404; the run row and its messages stay", async () => {
      const { agent, session, run } = await seedWithRun();
      await deleteAgent(agent.id, session);

      const list = await app.inject({ method: "GET", url: `/agents/${agent.id}/runs`, headers: session });
      const read = await app.inject({ method: "GET", url: `/agents/${agent.id}/runs/${run.id}`, headers: session });
      const removed = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/runs/${run.id}`, headers: session });

      expect([list.statusCode, read.statusCode, removed.statusCode]).toEqual([404, 404, 404]);
      expect(await prisma.agentRun.count({ where: { id: run.id } })).toBe(1);
      expect(await prisma.agentMessage.count({ where: { runId: run.id } })).toBe(2);
    });

    it("(control) with the agent's deletedAt cleared, the same routes list, read and delete the run", async () => {
      const { agent, session, run } = await seedWithRun();
      await deleteAgent(agent.id, session);
      await prisma.agent.updateMany({ where: { id: agent.id }, data: { deletedAt: null, deletedById: null } });

      const list = await app.inject({ method: "GET", url: `/agents/${agent.id}/runs`, headers: session });
      const read = await app.inject({ method: "GET", url: `/agents/${agent.id}/runs/${run.id}`, headers: session });
      const removed = await app.inject({ method: "DELETE", url: `/agents/${agent.id}/runs/${run.id}`, headers: session });

      expect([list.statusCode, list.json().map((r: { id: string }) => r.id)]).toEqual([200, [run.id]]);
      expect([read.statusCode, removed.statusCode]).toEqual([200, 204]);
    });
  });

  it("RNX-124 AC4: an unknown agent id still lists no runs (200 [])", async () => {
    const { session } = await seed();

    const res = await app.inject({ method: "GET", url: "/agents/00000000-0000-4000-8000-000000000000/runs", headers: session });

    expect([res.statusCode, res.json()]).toEqual([200, []]);
  });

  it("RNX-124 AC10: deleting the agent leaves its usage rows and the totals as they were (ledger entries with its agentId, usage logs, balance)", async () => {
    const { user, agent, session } = await seed();
    fake.enqueue({ content: "none" }, { content: "Hello there", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    await postChat(agent.id, session);
    const totals = async () => ({
      agentLedger: await prisma.creditLedgerEntry.aggregate({ where: { agentId: agent.id }, _count: true, _sum: { amount: true } }),
      ledger: await prisma.creditLedgerEntry.aggregate({ _count: true, _sum: { amount: true } }),
      usage: await moduleRef.get(UsageService).getUsageByUser(user.id),
      balance: await prisma.creditAccount.findMany({ select: { balance: true } }),
    });
    const before = await totals();
    expect(before.agentLedger._count).toBeGreaterThan(0);

    expect((await deleteAgent(agent.id, session)).statusCode).toBe(204);

    expect(await totals()).toEqual(before);
  });
});
