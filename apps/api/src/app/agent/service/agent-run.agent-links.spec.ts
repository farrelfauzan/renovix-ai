import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentService } from "./agent.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
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

// RNX-118 (PRD 10, D81; replaces RX-112's sub-agent suite): an agent run offers call_agent and lists the callable
// agents only when the agent has links and the runner is the workspace owner or a current collaborator there. The
// callee must be a linked agent in the caller's workspace; any other name is refused and never runs. A public agent
// run by anyone outside its workspace stands alone (R17). No keyword forces a call any more, and a clone of the
// "Team Coordinator" template has no links and no delegate tool row. These collaborators load ESM-only packages and
// are stubbed below.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const CALL_AGENT = {
  type: "function",
  function: { name: "call_agent", description: "Call", parameters: {} },
};

describe("RNX-118: agent runs call only linked agents (test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AgentRunService;
  const toolOptions: Array<{ injectCallAgent?: boolean }> = [];

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          AgentLinkService,
          AgentService,
          WorkspaceService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          {
            // Same call_agent rule as AgentToolService.buildToolSchemas (agent-tool.service.spec.ts)
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectCallAgent?: boolean },
              ) => {
                toolOptions.push({ injectCallAgent: options?.injectCallAgent });
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
    toolOptions.length = 0;
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

  /** A subscribed, funded user on a plan with this slug (each can pay for a run, so only the link rule decides). */
  const payingUser = async (planSlug?: string) => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, planSlug ? { slug: planSlug } : {});
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /** The owner's workspace with agent A (public and active when asked) and its callee B, linked A -> B when asked. */
  const seed = async ({ linked, isPublic = false, ownerPlan }: { linked: boolean; isPublic?: boolean; ownerPlan?: string }) => {
    const owner = await payingUser(ownerPlan);
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const a = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, status: "active", isPublic });
    const b = await createAgent(prisma, {
      userId: owner.id,
      workspaceId: workspace.id,
      name: "Research helper",
      description: "Finds sources",
      systemPrompt: "CALLEE B PROMPT",
      status: "active",
    });
    if (linked) await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: b.id } });
    return { owner, workspace, a, b };
  };

  const sent = () => JSON.stringify(fake.requests);
  const toolNames = (i: number) => (fake.requests[i].tools ?? []).map((t: any) => t.function.name);
  const systemPrompt = (i: number) => String(fake.requests[i].messages[0].content);
  const lastToolResult = () =>
    fake.requests[fake.requests.length - 1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);
  const callB = (agent: string) => ({ toolCalls: [{ name: "call_agent", arguments: { agent, task: "do it" } }] });

  describe("the owner runs A", () => {
    it("with A -> B: call_agent is offered and B is listed with its description (positive control)", async () => {
      const { owner, a, b } = await seed({ linked: true });
      fake.enqueue({ content: "Hello" });

      await service.chat(owner.id, a.id, "Hi");

      expect(toolNames(0)).toEqual(["call_agent"]);
      expect(systemPrompt(0)).toContain(`## Callable Agents\n- Research helper (id: ${b.id}): Finds sources`);
    });

    it.each([
      ["name (any case)", (b: { name: string }) => b.name.toUpperCase()],
      ["id", (b: { id: string }) => b.id],
    ])("with A -> B, the model calls B by %s: the one-hop call runs B (positive control)", async (_by, pick) => {
      const { owner, a, b } = await seed({ linked: true });
      fake.enqueue(callB(pick(b)), { content: "B answer" }, { content: "A final" });

      const res = await service.chat(owner.id, a.id, "Hi");

      expect(fake.requests).toHaveLength(3);
      expect(fake.requests[1].messages).toEqual([
        { role: "system", content: "CALLEE B PROMPT" },
        { role: "user", content: `Task from agent "${a.name}": do it` },
      ]);
      expect(lastToolResult()).toEqual(["B answer"]);
      expect(res.message.content).toBe("A final");
    });

    it("the optional context reaches the called agent", async () => {
      const { owner, a, b } = await seed({ linked: true });
      fake.enqueue(
        { toolCalls: [{ name: "call_agent", arguments: { agent: b.id, task: "do it", context: "the Q3 numbers" } }] },
        { content: "B answer" },
        { content: "A final" },
      );

      await service.chat(owner.id, a.id, "Hi");

      expect(fake.requests[1].messages[1].content).toBe(`Task from agent "${a.name}": do it\n\nContext: the Q3 numbers`);
    });

    it("without a link: call_agent is not offered, no agent is listed, and a call to B by name is refused (B never runs)", async () => {
      const { owner, a, b } = await seed({ linked: false });
      fake.enqueue(callB(b.name), { content: "Done" });

      await service.chat(owner.id, a.id, "Hi");

      expect(toolOptions).toEqual([{ injectCallAgent: false }]);
      expect(toolNames(0)).toEqual([]);
      expect(systemPrompt(0)).not.toContain("Callable Agents");
      expect(systemPrompt(0)).not.toContain("None configured");
      // A's call, then A again with the tool result: no call to B in between
      expect(fake.requests).toHaveLength(2);
      expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
      expect(sent()).not.toContain("CALLEE B PROMPT");
    });

    it("a link to an agent in another workspace (written straight to the database) is not listed, and calling it is refused", async () => {
      const { owner, a } = await seed({ linked: false });
      const otherWorkspace = await createWorkspace(prisma, { ownerId: owner.id });
      const foreign = await createAgent(prisma, {
        userId: owner.id,
        workspaceId: otherWorkspace.id,
        systemPrompt: "OTHER WORKSPACE PROMPT",
        status: "active",
      });
      await prisma.agentLink.create({ data: { callerAgentId: a.id, calleeAgentId: foreign.id } });
      fake.enqueue(callB(foreign.id), { content: "Done" });

      await service.chat(owner.id, a.id, "Hi");

      expect(toolNames(0)).toEqual([]);
      expect(systemPrompt(0)).not.toContain(foreign.id);
      expect(fake.requests).toHaveLength(2);
      expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
      expect(sent()).not.toContain("OTHER WORKSPACE PROMPT");
    });

    it("a linked callee that is not active is not listed", async () => {
      const { owner, a, b } = await seed({ linked: true });
      await prisma.agent.update({ where: { id: b.id }, data: { status: "draft" } });
      fake.enqueue({ content: "Hello" });

      await service.chat(owner.id, a.id, "Hi");

      expect(toolNames(0)).toEqual([]);
      expect(sent()).not.toContain(b.id);
    });

    it.each([["Please delegate this to your helper"], ["Tolong delegasikan ke sub agent"]])(
      "a message with a delegation keyword (%s) forces no call: tool_choice stays auto and B never runs",
      async (message) => {
        const { owner, a } = await seed({ linked: true });
        fake.enqueue({ content: "Answered myself" });

        const res = await service.chat(owner.id, a.id, message);

        expect(fake.requests).toHaveLength(1);
        expect(fake.requests[0].tool_choice).toBe("auto");
        expect(res.message.content).toBe("Answered myself");
        expect(sent()).not.toContain("CALLEE B PROMPT");
      },
    );
  });

  describe("a public agent A with A -> B (R17: it stands alone for anyone outside its workspace)", () => {
    it("a non-member runs A: no call_agent is offered, B is not listed, and a call to B never runs", async () => {
      const { a, b } = await seed({ linked: true, isPublic: true });
      const stranger = await payingUser();
      fake.enqueue(callB(b.id), { content: "Done" });

      await service.chat(stranger.id, a.id, "Hi");

      expect(toolOptions).toEqual([{ injectCallAgent: false }]);
      expect(toolNames(0)).toEqual([]);
      expect(systemPrompt(0)).not.toContain(b.id);
      expect(fake.requests).toHaveLength(2);
      expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
      expect(sent()).not.toContain("CALLEE B PROMPT");
    });

    it("a removed member runs A: no call_agent is offered", async () => {
      const { a, workspace } = await seed({ linked: true, isPublic: true, ownerPlan: "enterprise" });
      const former = await payingUser();
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: former.id, role: "member", status: "removed" },
      });
      fake.enqueue({ content: "Hello" });

      await service.chat(former.id, a.id, "Hi");

      expect(toolNames(0)).toEqual([]);
    });

    it.each(["starter", "pro"])(
      "a member of a %s owner's workspace (no collaboration, D64) runs A: no call_agent is offered",
      async (ownerPlan) => {
        const { a, workspace } = await seed({ linked: true, isPublic: true, ownerPlan });
        const member = await payingUser();
        await prisma.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: member.id, role: "member", status: "active" },
        });
        fake.enqueue({ content: "Hello" });

        await service.chat(member.id, a.id, "Hi");

        expect(toolNames(0)).toEqual([]);
      },
    );

    it("a current collaborator of an Enterprise owner's workspace runs A: call_agent is offered and B runs (positive control)", async () => {
      const { a, b, workspace } = await seed({ linked: true, isPublic: true, ownerPlan: "enterprise" });
      const collaborator = await payingUser();
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: collaborator.id, role: "member", status: "active" },
      });
      fake.enqueue(callB(b.id), { content: "B answer" }, { content: "A final" });

      const res = await service.chat(collaborator.id, a.id, "Hi");

      expect(toolNames(0)).toEqual(["call_agent"]);
      expect(fake.requests[1].messages[0]).toEqual({ role: "system", content: "CALLEE B PROMPT" });
      expect(res.message.content).toBe("A final");
    });

    it("the owner runs A: B runs (positive control)", async () => {
      const { owner, a, b } = await seed({ linked: true, isPublic: true });
      fake.enqueue(callB(b.id), { content: "B answer" }, { content: "A final" });

      const res = await service.chat(owner.id, a.id, "Hi");

      expect(fake.requests).toHaveLength(3);
      expect(fake.requests[1].messages[0]).toEqual({ role: "system", content: "CALLEE B PROMPT" });
      expect(res.message.content).toBe("A final");
    });
  });

  describe('a clone of the "Team Coordinator" template', () => {
    it("has no links and no delegate tool row, and running it makes no call", async () => {
      const system = await createUser(prisma);
      const template = await createAgent(prisma, {
        userId: system.id,
        name: "Team Coordinator",
        slug: "team-coordinator",
        isPublic: true,
        status: "active",
      });
      // A template seeded before RNX-118 still has the old delegate row; give it a link too
      await prisma.agentTool.createMany({
        data: ["delegate_to_subagent", "memory_store", "slack_send_message"].map((toolType) => ({
          agentId: template.id,
          toolType,
        })),
      });
      const helper = await createAgent(prisma, {
        userId: system.id,
        workspaceId: template.workspaceId,
        name: "Coordinator helper",
        systemPrompt: "TEMPLATE HELPER PROMPT",
        status: "active",
      });
      await prisma.agentLink.create({ data: { callerAgentId: template.id, calleeAgentId: helper.id } });
      const user = await payingUser();

      const clone = await moduleRef.get(AgentService).cloneFromTemplate(user.id, template.id);
      await prisma.agent.update({ where: { id: clone!.id }, data: { status: "active" } });
      fake.enqueue(callB(helper.name), { content: "Done" });
      await service.chat(user.id, clone!.id, "Hi");

      expect(await prisma.agentLink.count({ where: { callerAgentId: clone!.id } })).toBe(0);
      expect((await prisma.agentTool.findMany({ where: { agentId: clone!.id } })).map((t) => t.toolType).sort()).toEqual([
        "memory_store",
        "slack_send_message",
      ]);
      expect(toolNames(0)).toEqual([]);
      expect(fake.requests).toHaveLength(2);
      expect(lastToolResult()).toEqual(["Error: Agent not found or not linked."]);
      expect(sent()).not.toContain("TEMPLATE HELPER PROMPT");
    });
  });
});
