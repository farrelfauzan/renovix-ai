import { TestingModule } from "@nestjs/testing";
import { ReminderScheduler } from "./reminder.scheduler";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { UsageService } from "../../usage/service/usage.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { ReminderService } from "../service/reminder.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { ChannelChatRoomRepository } from "../../channel/repository/channel-chat-room.repository";
import { ReminderRepository } from "../repository/reminder.repository";
import { WorkspaceRepository } from "../../workspace/repository/workspace.repository";

const mockMcpConnect = jest.fn();

// RNX-276: the reminder loop (RM) runs a tool only when it was offered to the run. Real ReminderScheduler and
// AgentToolService (its web search, document and memory collaborators are spies); fake provider. These
// collaborators load ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../channel/repository/channel-chat-room.repository", () => ({ ChannelChatRoomRepository: class {} }));
jest.mock("../repository/reminder.repository", () => ({ ReminderRepository: class {} }));
jest.mock("../../workspace/repository/workspace.repository", () => ({ WorkspaceRepository: class {} }));

describe("RNX-276: the reminder loop runs only tools offered to the run (test database, fake provider, real tool service)", () => {
  const fake = new FakeProviderAdapter();
  const mockWebSearch = jest.fn();
  const mockGenerateDocument = jest.fn();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let scheduler: ReminderScheduler;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ReminderScheduler,
          ReminderService,
          AgentRunPolicyService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          AgentToolService,
          { provide: McpClientService, useValue: { connect: mockMcpConnect, close: mockMcpConnect } },
          { provide: McpService, useValue: {} },
          { provide: McpUserService, useValue: { getUserConnectedProviders: async () => new Map() } },
          { provide: ChannelChatRoomRepository, useValue: { findChatRoomByName: async () => null, createChatRoom: async () => ({ id: "room-1" }) } },
          { provide: ReminderRepository, useValue: {} },
          { provide: WorkspaceRepository, useValue: { findDefaultFlag: async () => null } },
          {
            provide: WebSearchService,
            useValue: { search: mockWebSearch },
          },
          {
            provide: DocumentService,
            useValue: { generate: mockGenerateDocument, generateWithStorage: mockGenerateDocument },
          },
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined, storeExplicit: async () => undefined } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    scheduler = moduleRef.get(ReminderScheduler);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    for (const mock of [mockWebSearch, mockGenerateDocument]) mock.mockClear();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(() => moduleRef?.close());

  /** A due reminder of a subscribed, funded user, with an agent whose tool rows are `toolTypes`. */
  const seedReminder = async (toolTypes: string[] = []) => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id, status: "active" });
    for (const toolType of toolTypes) await prisma.agentTool.create({ data: { agentId: agent.id, toolType } });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id, name: "general" } });
    const reminder = await prisma.reminder.create({
      data: {
        userId: user.id,
        agentId: agent.id,
        channelId: channel.id,
        chatRoomId: room.id,
        prompt: "Daily summary please",
        cronExpression: "0 8 * * *",
        timezone: "UTC",
        nextRunAt: new Date(),
      },
    });
    const agentWithTools = await prisma.agent.findUniqueOrThrow({
      where: { id: agent.id },
      include: { tools: true },
    });
    return { user, agent: agentWithTools, channel, room, reminder: { ...reminder, agent: agentWithTools } };
  };

  const offeredToolNames = (requestIndex: number) =>
    (fake.requests[requestIndex].tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);

  // The run policy is checked in fireReminder; these runs are inside the owner's own workspace.
  const executeReminder = (reminder: unknown): Promise<void> => scheduler["executeReminder"](reminder, "inside");

  it("RNX-276 calculator not offered (RM): a call to it runs nothing; the model gets 'not available' and the run finishes", async () => {
    const { reminder } = await seedReminder();
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "2+2" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Here is your summary", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    await executeReminder(reminder);

    expect(offeredToolNames(0)).toEqual(["create_document"]);
    expect(fake.requests[1].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: 'Tool "calculator" is not available. It may require an MCP integration to be connected.',
    });
    expect(fake.requests).toHaveLength(2);
  });

  it("RNX-276 web_search not offered (RM): a call to it runs no web search; the model gets 'not available' and the run finishes", async () => {
    const { reminder } = await seedReminder();
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "web_search", arguments: { query: "prices" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Here is your summary", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    await executeReminder(reminder);

    expect(offeredToolNames(0)).toEqual(["create_document"]);
    expect(mockWebSearch.mock.calls.length).toBe(0);
    expect(fake.requests[1].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: 'Tool "web_search" is not available. It may require an MCP integration to be connected.',
    });
  });

  it("RNX-276 knowledge_retrieval not offered (RM): a call to it returns 'not available' and nothing is written", async () => {
    const { reminder } = await seedReminder();
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "knowledge_retrieval", arguments: { query: "prices" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Here is your summary", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    await executeReminder(reminder);

    expect(fake.requests[1].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: 'Tool "knowledge_retrieval" is not available. It may require an MCP integration to be connected.',
    });
  });

  it("RNX-276 control (RM): a built-in that WAS offered still runs", async () => {
    const { reminder } = await seedReminder(["calculator"]);
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "2+2" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "It is 4.", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    await executeReminder(reminder);

    expect(offeredToolNames(0)).toEqual(["calculator", "create_document"]);
    expect(fake.requests[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: "Result: 4" });
  });

  it("RNX-276 control (RM): an offered MCP tool still runs", async () => {
    const { reminder } = await seedReminder();
    // The run's session is built by buildToolSchemasWithMcp; with no connected providers it offers
    // only the built-ins. An MCP tool name that was never offered must be refused (covered above);
    // here the offered control is create_document, which the reminder run offers to every agent.
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "create_document", arguments: { content: "# Doc", format: "pdf" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Here is your summary", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );
    mockGenerateDocument.mockResolvedValue({ filename: "doc.pdf" });

    await executeReminder(reminder);

    expect(offeredToolNames(0)).toEqual(["create_document"]);
    expect(mockGenerateDocument.mock.calls.length).toBe(1);
    expect((fake.requests[1].messages.at(-1) as { content: string }).content).toMatch(/Successfully generated PDF document/);
  });
});
