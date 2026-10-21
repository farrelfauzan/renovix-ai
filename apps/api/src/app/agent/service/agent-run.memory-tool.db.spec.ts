import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentLinkService } from "./agent-link.service";
import { ChannelChatService } from "../../channel/service/channel-chat.service";
import { ChannelService } from "../../channel/service/channel.service";
import { ReminderScheduler } from "../../reminder/scheduler/reminder.scheduler";
import { ReminderService } from "../../reminder/service/reminder.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpRegistryService } from "../../mcp/service/mcp-registry.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import type { FakeTurn } from "../../providers/fake.adapter";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser, createWorkspace } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-119 (D257) AC5, the memory tool: a run outside the agent's workspace (an outsider on a public agent) writes no
// workspace memory through the `memory_store` tool either; the tool answers the model with a plain refusal. A run
// inside (a collaborator) stores as before. The scope reaches the tool on every run entry (agent chat, channel chat,
// reminder). Real AgentRunService, ChannelChatService, ReminderScheduler, run policy, AgentToolService and
// AgentMemoryService on the test database, fake provider. The modules mocked below load ESM-only packages.
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const FACT = "RNX119 REMEMBERED FACT";
const REFUSED = "Memory is not available for this run.";

describe("RNX-119: the memory_store tool follows the run's scope (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let agentRuns: AgentRunService;
  let channelChats: ChannelChatService;
  let memory: AgentMemoryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          ChannelChatService,
          ChannelService,
          ReminderScheduler,
          ReminderService,
          AgentRunPolicyService,
          AgentLinkService,
          AgentMemoryService,
          AgentToolService,
          WorkspaceQuotaService,
          McpClientService,
          McpService,
          McpRegistryService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: McpUserService, useValue: { getUserConnectedProviders: async () => new Map() } },
          { provide: WebSearchService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
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
    agentRuns = moduleRef.get(AgentRunService);
    channelChats = moduleRef.get(ChannelChatService);
    memory = moduleRef.get(AgentMemoryService);
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

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A subscribed user funded with 1 credit, on a plan with this slug. */
  const newUser = async (planSlug?: string) => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, planSlug ? { slug: planSlug, maxWorkspaceUsers: 100 } : {});
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    return user;
  };

  /**
   * An Enterprise owner's shared workspace with a public active agent that has the memory_store tool, an outsider and
   * an active collaborator, each with the agent in their own channel.
   */
  const seed = async () => {
    const owner = await newUser("enterprise");
    const workspace = await createWorkspace(prisma, { ownerId: owner.id });
    const agent = await createAgent(prisma, { userId: owner.id, workspaceId: workspace.id, status: "active", isPublic: true });
    await prisma.agentTool.create({ data: { agentId: agent.id, toolType: "memory_store" } });
    const outsider = await newUser();
    const collaborator = await newUser();
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: collaborator.id, role: "member", status: "active", joinedAt: new Date() },
    });
    const channelOf = async (userId: string) => {
      const channel = await prisma.channel.create({ data: { userId, name: "My room" } });
      await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
      return channel;
    };
    return { owner, workspace, agent, outsider, collaborator, outsiderChannel: await channelOf(outsider.id), collaboratorChannel: await channelOf(collaborator.id) };
  };

  const storeTurn: FakeTurn = { toolCalls: [{ name: "memory_store", arguments: { fact: FACT, type: "fact" } }] };

  /** Runs and waits for the run's (asynchronous) memory extraction, so its model call is counted. */
  const settled = async (run: () => Promise<unknown>) => {
    const extraction = jest.spyOn(memory, "extractAndStore");
    await run();
    await Promise.all(extraction.mock.results.map((r) => r.value));
  };

  const toolResults = () =>
    fake.requests[1].messages.filter((m: any) => m.role === "tool").map((m: any) => m.content);

  const storedFacts = async () => ({
    workspace: await prisma.workspaceMemory.findMany({ where: { content: FACT } }),
    user: await prisma.userMemory.findMany({ where: { content: FACT } }),
  });

  describe("a run outside the workspace: memory_store writes nothing and answers with a plain refusal", () => {
    it("agent chat", async () => {
      const { agent, outsider } = await seed();
      fake.enqueue(storeTurn, { content: "Done" });

      await settled(() => agentRuns.chat(outsider.id, agent.id, "Remember this"));

      expect(fake.requests[0].tools?.map((t: any) => t.function.name)).toContain("memory_store");
      expect(toolResults()).toEqual([REFUSED]);
      expect(await storedFacts()).toEqual({ workspace: [], user: [] });
      expect(fake.requests).toHaveLength(2);
    });

    it("channel chat", async () => {
      const { agent, outsider, outsiderChannel } = await seed();
      fake.enqueue(storeTurn, { content: "Done" });

      await settled(() => channelChats.chat(outsider.id, outsiderChannel.id, agent.id, "Remember this"));

      expect(toolResults()).toEqual([REFUSED]);
      expect(await storedFacts()).toEqual({ workspace: [], user: [] });
      expect(fake.requests).toHaveLength(2);
    });

    it("reminder fire", async () => {
      const { agent, outsider, outsiderChannel } = await seed();
      const room = await prisma.channelChatRoom.create({ data: { channelId: outsiderChannel.id } });
      await prisma.reminder.create({
        data: {
          userId: outsider.id,
          agentId: agent.id,
          channelId: outsiderChannel.id,
          chatRoomId: room.id,
          prompt: "Remember this daily",
          cronExpression: "0 8 * * *",
          timezone: "UTC",
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });
      fake.enqueue(storeTurn, { content: "Done" });

      await moduleRef.get(ReminderScheduler).processReminders();

      expect(toolResults()).toEqual([REFUSED]);
      expect(await storedFacts()).toEqual({ workspace: [], user: [] });
    });
  });

  /**
   * RNX-119 review round 1 (blocking): collaborator C runs W's private agent (C is an Enterprise collaborator of W) in
   * C's own channel, which is the channel of C's shared workspace Y. The run's facts (memory_store and the extraction)
   * belong to W, never to Y.
   */
  describe("a channel linked to another workspace of the runner (review round 1)", () => {
    const EXTRACTED = "RNX119 EXTRACTED FACT";

    const seedChannelInOtherWorkspace = async () => {
      const seeded = await seed();
      await prisma.agent.update({ where: { id: seeded.agent.id }, data: { isPublic: false } });
      const yWorkspace = await createWorkspace(prisma, { ownerId: seeded.collaborator.id, channelId: seeded.collaboratorChannel.id });
      return { ...seeded, yWorkspace };
    };

    const rowsIn = async (workspaceId: string) =>
      (await prisma.workspaceMemory.findMany({ where: { workspaceId }, orderBy: { content: "asc" } })).map((r) => r.content);

    it("channel chat: memory_store and the extraction write to W, nothing to the channel's workspace Y", async () => {
      const { workspace, agent, collaborator, collaboratorChannel, yWorkspace } = await seedChannelInOtherWorkspace();
      fake.enqueue(storeTurn, { content: "Done" }, { content: `[{"type":"fact","content":"${EXTRACTED}","confidence":0.9}]` });

      await settled(() => channelChats.chat(collaborator.id, collaboratorChannel.id, agent.id, "Remember this"));

      expect(await rowsIn(yWorkspace.id)).toEqual([]);
      expect(await rowsIn(workspace.id)).toEqual([EXTRACTED, FACT]);
    });

    it("reminder fire: memory_store writes to W, nothing to the channel's workspace Y", async () => {
      const { workspace, agent, collaborator, collaboratorChannel, yWorkspace } = await seedChannelInOtherWorkspace();
      const room = await prisma.channelChatRoom.create({ data: { channelId: collaboratorChannel.id } });
      await prisma.reminder.create({
        data: {
          userId: collaborator.id,
          agentId: agent.id,
          channelId: collaboratorChannel.id,
          chatRoomId: room.id,
          prompt: "Remember this daily",
          cronExpression: "0 8 * * *",
          timezone: "UTC",
          nextRunAt: new Date(Date.now() - 60_000),
        },
      });
      fake.enqueue(storeTurn, { content: "Done" });

      await moduleRef.get(ReminderScheduler).processReminders();

      expect(await rowsIn(yWorkspace.id)).toEqual([]);
      expect(await rowsIn(workspace.id)).toEqual([FACT]);
    });

    it("channel chat: the prompt reads W's memory, never Y's", async () => {
      const { workspace, agent, collaborator, collaboratorChannel, yWorkspace } = await seedChannelInOtherWorkspace();
      await prisma.workspaceMemory.createMany({
        data: [
          { workspaceId: workspace.id, type: "fact", content: "W MEMORY", status: "active" },
          { workspaceId: yWorkspace.id, type: "fact", content: "Y MEMORY", status: "active" },
        ],
      });
      fake.enqueue({ content: "Done" }, { content: "[]" });

      await settled(() => channelChats.chat(collaborator.id, collaboratorChannel.id, agent.id, "Hi"));

      const prompt = String(fake.requests[0].messages[0].content);
      expect(prompt).toContain("W MEMORY");
      expect(prompt).not.toContain("Y MEMORY");
    });
  });

  describe("a run inside the workspace stores as before (control)", () => {
    it("agent chat: a collaborator's memory_store writes the fact to the workspace memory", async () => {
      const { workspace, agent, collaborator } = await seed();
      fake.enqueue(storeTurn, { content: "Done" }, { content: "[]" });

      await settled(() => agentRuns.chat(collaborator.id, agent.id, "Remember this"));

      expect(toolResults()).toEqual([`Successfully stored memory: "${FACT}" (type: fact)`]);
      const { workspace: rows } = await storedFacts();
      expect(rows.map((r) => [r.workspaceId, r.createdById])).toEqual([[workspace.id, collaborator.id]]);
    });

    it("channel chat: a collaborator's memory_store writes the fact to the workspace memory", async () => {
      const { workspace, agent, collaborator, collaboratorChannel } = await seed();
      fake.enqueue(storeTurn, { content: "Done" }, { content: "[]" });

      await settled(() => channelChats.chat(collaborator.id, collaboratorChannel.id, agent.id, "Remember this"));

      const { workspace: rows } = await storedFacts();
      expect(rows.map((r) => [r.workspaceId, r.createdById])).toEqual([[workspace.id, collaborator.id]]);
    });
  });
});
