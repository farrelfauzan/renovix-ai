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
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-203: the runs of an agent (chat and the run history) belong to its workspace owner, not its creator, and a
// delegation only loads sub-agents in the parent's workspace. Rows where the creator and the workspace owner differ
// are written straight to the database. These collaborators load ESM-only packages and are stubbed.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const DELEGATE = {
  type: "function",
  function: { name: "delegate_to_subagent", description: "Delegate", parameters: {} },
};

describe("RNX-203: agent runs through the workspace owner (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          {
            // Same delegation rule as AgentToolService.buildToolSchemas
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectDelegation?: boolean },
              ) => (options?.injectDelegation ? [DELEGATE] : []),
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

  /** A subscribed, funded user (each can pay for a run, so only the ownership rule decides). */
  const payingUser = async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /** Workspace W owned by the owner; the private draft agent in W was created by the creator, not a member of W. */
  const seedAgentInOwnersWorkspace = async () => {
    const owner = await payingUser();
    const creator = await payingUser();
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, {
      userId: creator.id,
      workspaceId: workspace.id,
      systemPrompt: "SHARED AGENT PROMPT",
    });
    return { owner, creator, agent };
  };

  describe("chat", () => {
    it("the creator who does not own the workspace: 404 Agent not found, no model call, no run", async () => {
      const { creator, agent } = await seedAgentInOwnersWorkspace();

      await expect(service.chat(creator.id, agent.id, "Hi")).rejects.toThrow(new NotFoundException("Agent not found"));

      expect(fake.requests).toHaveLength(0);
      expect(await prisma.agentRun.count()).toBe(0);
    });

    it("the workspace owner who did not create it runs it (positive control)", async () => {
      const { owner, agent } = await seedAgentInOwnersWorkspace();
      fake.enqueue({ content: "Hello" });

      const res = await service.chat(owner.id, agent.id, "Hi");

      expect(res.message.content).toBe("Hello");
      expect(String(fake.requests[0].messages[0].content)).toContain("SHARED AGENT PROMPT");
    });
  });

  describe.each([["listRuns"], ["getRun"], ["deleteRun"]] as const)("%s", (method) => {
    const call = (userId: string, agentId: string, runId: string) =>
      method === "listRuns" ? service.listRuns(userId, agentId) : service[method](userId, agentId, runId);

    const seedRun = (agentId: string) =>
      prisma.agentRun.create({ data: { agentId, sessionId: "s-1", channelType: "web" } });

    it("the creator who does not own the workspace: 404 Agent not found, the run kept", async () => {
      const { creator, agent } = await seedAgentInOwnersWorkspace();
      const agentRun = await seedRun(agent.id);

      await expect(call(creator.id, agent.id, agentRun.id)).rejects.toThrow(new NotFoundException("Agent not found"));

      expect(await prisma.agentRun.count({ where: { id: agentRun.id } })).toBe(1);
    });

    it("the workspace owner who did not create it reaches the run (positive control)", async () => {
      const { owner, agent } = await seedAgentInOwnersWorkspace();
      const agentRun = await seedRun(agent.id);

      await expect(call(owner.id, agent.id, agentRun.id)).resolves.toBeTruthy();
    });
  });

  describe("delegation", () => {
    /**
     * The caller's parent agent in their default workspace with a sub-agent there, and a second sub-agent under the
     * same parent by the same creator but in another workspace of the caller.
     */
    const seedSubAgents = async () => {
      const caller = await payingUser();
      const parent = await createAgent(prisma, { userId: caller.id, agentType: "parent", status: "active" });
      const sameWorkspaceSub = await createAgent(prisma, {
        userId: caller.id,
        name: "Same workspace helper",
        systemPrompt: "SAME WORKSPACE SUB PROMPT",
        agentType: "sub_agent",
        status: "active",
        parentAgentId: parent.id,
      });
      const otherWorkspace = await createWorkspace(prisma, { ownerId: caller.id });
      const otherWorkspaceSub = await createAgent(prisma, {
        userId: caller.id,
        name: "Other workspace helper",
        systemPrompt: "OTHER WORKSPACE SUB PROMPT",
        agentType: "sub_agent",
        status: "active",
        parentAgentId: parent.id,
        workspaceId: otherWorkspace.id,
      });
      return { caller, parent, sameWorkspaceSub, otherWorkspaceSub };
    };

    const lastToolResult = () =>
      (fake.requests[fake.requests.length - 1].messages as Array<{ role: string; content: unknown }>)
        .filter((m) => m.role === "tool")
        .map((m) => m.content);

    it("a sub-agent of the parent's creator in another workspace is not listed in the prompt", async () => {
      const { caller, parent, sameWorkspaceSub, otherWorkspaceSub } = await seedSubAgents();
      fake.enqueue({ content: "Hello" });

      await service.chat(caller.id, parent.id, "Hi");

      const prompt = String(fake.requests[0].messages[0].content);
      expect(prompt).toContain(`${sameWorkspaceSub.name} (id: ${sameWorkspaceSub.id})`);
      expect(prompt).not.toContain(otherWorkspaceSub.id);
    });

    it("delegating to a sub-agent of the parent's creator in another workspace is refused and it never runs", async () => {
      const { caller, parent, otherWorkspaceSub } = await seedSubAgents();
      fake.enqueue(
        { toolCalls: [{ name: "delegate_to_subagent", arguments: { subAgentId: otherWorkspaceSub.id, task: "do it" } }] },
        { content: "Done" },
      );

      await service.chat(caller.id, parent.id, "Hi");

      expect(fake.requests).toHaveLength(2);
      expect(lastToolResult()).toEqual(["Error: Sub-agent not found or not authorized."]);
      expect(JSON.stringify(fake.requests)).not.toContain("OTHER WORKSPACE SUB PROMPT");
    });

    it("delegating to the sub-agent in the parent's workspace loads and runs it (control)", async () => {
      const { caller, parent, sameWorkspaceSub } = await seedSubAgents();
      fake.enqueue(
        { toolCalls: [{ name: "delegate_to_subagent", arguments: { subAgentId: sameWorkspaceSub.id, task: "do it" } }] },
        { content: "Sub-agent answer" },
        { content: "Parent final" },
      );

      const res = await service.chat(caller.id, parent.id, "Hi");

      expect(fake.requests).toHaveLength(3);
      expect(fake.requests[1].messages[0]).toEqual({ role: "system", content: "SAME WORKSPACE SUB PROMPT" });
      expect(lastToolResult()).toEqual(["Sub-agent answer"]);
      expect(res.message.content).toBe("Parent final");
    });
  });
});
