import { NotFoundException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentRepository } from "../repository/agent.repository";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
} from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { AgentLinkService } from "./agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";

// RX-134: each condition of the agent lookups of a run (the run's agent, the
// called agent of a call_agent (RNX-118: was the sub-agent of a delegation), the
// agent of the run history routes) decides a case on its own. Written before the
// lookups moved to AgentRepository and run unchanged after. These collaborators load ESM-only packages and are stubbed.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const CALL_AGENT = {
  type: "function",
  function: { name: "call_agent", description: "Call", parameters: {} },
};

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

describe("RX-134: the agent lookups of a run, one condition at a time (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const toolsOffered: Array<Array<{ toolType: string }>> = [];
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          {
            // Records the tools of the agent; same call_agent rule as AgentToolService.buildToolSchemas
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async (
                tools: Array<{ toolType: string }>,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectCallAgent?: boolean },
              ) => {
                toolsOffered.push(tools);
                return options?.injectCallAgent ? [CALL_AGENT] : [];
              },
              cleanupMcpConnections: async () => undefined,
            },
          },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
          },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
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
    service = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    toolsOffered.length = 0;
    await createResolvableModel(prisma, {
      slug: "test-model",
      modelName: "test-model",
      inputPrice: 0.000001,
      outputPrice: 0.000001,
      maxTokens: 8192,
    });
    // RX-22b: agent runs are charged on the ledger at the tier rate.
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** Bob (subscribed and funded, the caller) and Alice (another user). */
  const seedUsers = async () => {
    const plan = await createPlan(prisma);
    const bob = await createUser(prisma);
    const alice = await createUser(prisma);
    await createSubscription(prisma, { userId: bob.id, planId: plan.id });
    await fundPaidWallet(prisma, bob.id, "1");
    return { bob, alice };
  };

  // RX-22b: the stream run (chatStream / streamExecution) had no caller and was removed; only the sync run is left.
  const run = (_mode: "sync", userId: string, agentId: string) => service.chat(userId, agentId, "Hi");

  const systemPrompt = (i: number) => String(fake.requests[i].messages[0].content);

  describe.each([["sync"]] as const)("the run's agent (%s run)", (mode) => {
    it("the owner runs their own private draft agent (only the userId branch lets it through)", async () => {
      const { bob } = await seedUsers();
      const agent = await createAgent(prisma, { userId: bob.id, systemPrompt: "BOB PRIVATE PROMPT" });
      fake.enqueue({ content: "Hello" });

      await run(mode, bob.id, agent.id);

      expect(fake.requests).toHaveLength(1);
      expect(systemPrompt(0)).toContain("BOB PRIVATE PROMPT");
    });

    it("another user's private draft agent: refused with 404 Agent not found, no model call, no run (userId decides)", async () => {
      const { bob, alice } = await seedUsers();
      const agent = await createAgent(prisma, { userId: alice.id });

      await expect(run(mode, bob.id, agent.id)).rejects.toThrow(new NotFoundException("Agent not found"));

      expect(fake.requests).toHaveLength(0);
      expect(await prisma.agentRun.count()).toBe(0);
    });

    it("another user's active agent that is not public: refused with 404 (isPublic decides)", async () => {
      const { bob, alice } = await seedUsers();
      const agent = await createAgent(prisma, { userId: alice.id, status: "active", isPublic: false });

      await expect(run(mode, bob.id, agent.id)).rejects.toThrow(new NotFoundException("Agent not found"));

      expect(fake.requests).toHaveLength(0);
    });

    it("another user's public agent that is not active: refused with 404 (status decides)", async () => {
      const { bob, alice } = await seedUsers();
      const agent = await createAgent(prisma, { userId: alice.id, status: "draft", isPublic: true });

      await expect(run(mode, bob.id, agent.id)).rejects.toThrow(new NotFoundException("Agent not found"));

      expect(fake.requests).toHaveLength(0);
    });

    it("another user's public active agent runs (positive control)", async () => {
      const { bob, alice } = await seedUsers();
      const agent = await createAgent(prisma, {
        userId: alice.id,
        status: "active",
        isPublic: true,
        systemPrompt: "ALICE PUBLIC PROMPT",
      });
      fake.enqueue({ content: "Hello" });

      await run(mode, bob.id, agent.id);

      expect(systemPrompt(0)).toContain("ALICE PUBLIC PROMPT");
    });

    it("the agent with the requested id runs, not the caller's other agent (id decides)", async () => {
      const { bob } = await seedUsers();
      await createAgent(prisma, { userId: bob.id, systemPrompt: "BOB FIRST PROMPT" });
      const target = await createAgent(prisma, { userId: bob.id, systemPrompt: "BOB TARGET PROMPT" });
      fake.enqueue({ content: "Hello" });

      await run(mode, bob.id, target.id);

      expect(systemPrompt(0)).toContain("BOB TARGET PROMPT");
      expect(systemPrompt(0)).not.toContain("BOB FIRST PROMPT");
    });

    it("only the enabled tools are loaded (tools: enabled decides)", async () => {
      const { bob } = await seedUsers();
      const agent = await createAgent(prisma, { userId: bob.id });
      await prisma.agentTool.createMany({
        data: [
          { agentId: agent.id, toolType: "calculator", enabled: true },
          { agentId: agent.id, toolType: "web_search", enabled: false },
        ],
      });
      fake.enqueue({ content: "Hello" });

      await run(mode, bob.id, agent.id);

      expect(toolsOffered[0].map((t) => t.toolType)).toEqual(["calculator"]);
    });

    it("only the active linked callees are listed (RNX-118: the callee's status decides)", async () => {
      const { bob } = await seedUsers();
      const parent = await createAgent(prisma, { userId: bob.id, status: "active" });
      const active = await createAgent(prisma, { userId: bob.id, name: "Bob active helper", status: "active" });
      const draft = await createAgent(prisma, { userId: bob.id, name: "Bob draft helper", status: "draft" });
      await prisma.agentLink.createMany({
        data: [active, draft].map((callee) => ({ callerAgentId: parent.id, calleeAgentId: callee.id })),
      });
      fake.enqueue({ content: "Hello" });

      await run(mode, bob.id, parent.id);

      expect(systemPrompt(0)).toContain(`${active.name} (id: ${active.id})`);
      expect(systemPrompt(0)).not.toContain(draft.id);
    });
  });

  // RX-22b: was checked through the removed stream run; now through the lookup the sync run uses.
  it("the run's lookup loads only the connected integrations (integrations: status decides)", async () => {
    const { bob } = await seedUsers();
    const agent = await createAgent(prisma, { userId: bob.id });
    await prisma.agentIntegration.createMany({
      data: [
        { agentId: agent.id, provider: "jira", config: {}, scopes: [], status: "connected" },
        { agentId: agent.id, provider: "notion", config: {}, scopes: [], status: "revoked" },
      ],
    });

    const loaded = await moduleRef.get(AgentRepository).findRunnableAgent(agent.id, bob.id);

    expect(loaded!.integrations.map((i: { provider: string }) => i.provider)).toEqual(["jira"]);
  });

  describe("the called agent of a call_agent (sync run, RNX-118)", () => {
    /** Bob's agent with a link to his own helper, so call_agent is offered. */
    const seedParent = async () => {
      const users = await seedUsers();
      const parent = await createAgent(prisma, { userId: users.bob.id, status: "active" });
      const ownSub = await createAgent(prisma, {
        userId: users.bob.id,
        name: "Bob own helper",
        systemPrompt: "BOB OWN SUB PROMPT",
        status: "active",
      });
      await prisma.agentLink.create({ data: { callerAgentId: parent.id, calleeAgentId: ownSub.id } });
      return { ...users, parent, ownSub };
    };

    /** Two turns: the call, then the caller's answer to a refusal (no turn is left over for the next test). */
    const delegateTo = (agent: string) =>
      fake.enqueue(
        { toolCalls: [{ name: "call_agent", arguments: { agent, task: "do it" } }] },
        { content: "Done" },
      );

    const lastToolResult = () =>
      (fake.requests[fake.requests.length - 1].messages as Array<{ role: string; content: unknown }>)
        .filter((m) => m.role === "tool")
        .map((m) => m.content);

    it("the caller's agent linked from another of their agents is refused (the link's caller decides)", async () => {
      const { bob, parent } = await seedParent();
      const otherParent = await createAgent(prisma, { userId: bob.id, status: "active" });
      const otherSub = await createAgent(prisma, {
        userId: bob.id,
        name: "Bob other parent's helper",
        systemPrompt: "OTHER PARENT SUB PROMPT",
        status: "active",
      });
      await prisma.agentLink.create({ data: { callerAgentId: otherParent.id, calleeAgentId: otherSub.id } });
      delegateTo(otherSub.id);

      await service.chat(bob.id, parent.id, "Hi");

      expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
      expect(JSON.stringify(fake.requests)).not.toContain("OTHER PARENT SUB PROMPT");
    });

    it("an active agent of the same workspace that is not linked is refused (the link decides)", async () => {
      const { bob, parent } = await seedParent();
      const unlinked = await createAgent(prisma, {
        userId: bob.id,
        name: "Bob unlinked agent",
        systemPrompt: "UNLINKED PROMPT",
        status: "active",
      });
      delegateTo(unlinked.name);

      await service.chat(bob.id, parent.id, "Hi");

      expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
      expect(JSON.stringify(fake.requests)).not.toContain("UNLINKED PROMPT");
    });

    it("an identifier that names no linked agent is refused; the linked callee is not run instead (id/name decides)", async () => {
      const { bob, parent } = await seedParent();
      delegateTo(UNKNOWN_ID);

      await service.chat(bob.id, parent.id, "Hi");

      expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
      expect(JSON.stringify(fake.requests)).not.toContain("BOB OWN SUB PROMPT");
    });
  });

  describe.each([["listRuns"], ["getRun"], ["deleteRun"]] as const)("the agent of %s", (method) => {
    const call = (userId: string, agentId: string, runId: string) =>
      method === "listRuns" ? service.listRuns(userId, agentId) : service[method](userId, agentId, runId);

    const seedRun = (agentId: string) =>
      prisma.agentRun.create({ data: { agentId, sessionId: "s-1", channelType: "web" } });

    it("the owner reaches their agent's run (positive control)", async () => {
      const { bob } = await seedUsers();
      const agent = await createAgent(prisma, { userId: bob.id });
      const agentRun = await seedRun(agent.id);

      await expect(call(bob.id, agent.id, agentRun.id)).resolves.toBeTruthy();
    });

    it("another user's agent, the caller owning none: 404 Agent not found, the run kept (userId decides)", async () => {
      const { bob, alice } = await seedUsers();
      const agent = await createAgent(prisma, { userId: alice.id });
      const agentRun = await seedRun(agent.id);

      await expect(call(bob.id, agent.id, agentRun.id)).rejects.toThrow(new NotFoundException("Agent not found"));

      expect(await prisma.agentRun.count({ where: { id: agentRun.id } })).toBe(1);
    });

    it("an unknown agent id while the caller owns an agent: 404 Agent not found (id decides)", async () => {
      const { bob } = await seedUsers();
      const agent = await createAgent(prisma, { userId: bob.id });
      const agentRun = await seedRun(agent.id);

      await expect(call(bob.id, UNKNOWN_ID, agentRun.id)).rejects.toThrow(new NotFoundException("Agent not found"));

      expect(await prisma.agentRun.count({ where: { id: agentRun.id } })).toBe(1);
    });
  });
});
