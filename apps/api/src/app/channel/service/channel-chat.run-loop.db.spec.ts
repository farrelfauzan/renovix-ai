import { TestingModule } from "@nestjs/testing";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { McpClientService } from "../../mcp/service/mcp-client.service";
import { McpService } from "../../mcp/service/mcp.service";
import { McpUserService } from "../../mcp/service/mcp-user.service";
import { WebSearchService } from "../../mcp/service/web-search.service";
import { DocumentService } from "../../document/service/document.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
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
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-16: characterization of the channel chat (CH) loop, as it is today: a 503 on the first attempt answered by the
// model's fallback (RNX-179), a call to a tool that was not offered, and a tool call with its follow-up, with the stored
// messages and the ledger entries of each. The real AgentToolService runs the tools (its MCP, web search, document and
// memory collaborators are spies); real ChannelChatService, ChannelService, meter and ledger on the test database; fake
// provider. These collaborators load ESM-only packages.
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../mcp/service/mcp-client.service", () => ({ McpClientService: class {} }));
jest.mock("../../mcp/service/mcp.service", () => ({ McpService: class {} }));
jest.mock("../../mcp/service/mcp-user.service", () => ({ McpUserService: class {} }));
jest.mock("../../mcp/service/web-search.service", () => ({ WebSearchService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const NOT_AVAILABLE = 'Tool "send_email" is not available. It may require an MCP integration to be connected.';

describe("RNX-16: channel chat loop scenarios (test database, fake provider, real tool service)", () => {
  const fake = new FakeProviderAdapter();
  const mockMcpConnect = jest.fn();
  const mockWebSearch = jest.fn();
  const mockGenerateDocument = jest.fn();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelChatService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          ChannelService,
          AgentRunPolicyService,
          AgentLinkService,
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
          { provide: WebSearchService, useValue: { search: mockWebSearch } },
          { provide: DocumentService, useValue: { generate: mockGenerateDocument, generateWithStorage: mockGenerateDocument } },
          {
            provide: AgentMemoryService,
            useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined },
          },
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
    service = moduleRef.get(ChannelChatService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    for (const mock of [mockMcpConnect, mockWebSearch, mockGenerateDocument]) mock.mockClear();
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** The standard model "test-model", with "fallback-model" as its one fallback when `withFallback` (RNX-179). */
  const seedModel = async ({ withFallback = false } = {}) => {
    const primary = await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    if (withFallback) {
      const fallback = await createResolvableModel(prisma, { slug: "fallback-model", modelName: "fallback-model", maxTokens: 8192 });
      await prisma.aiModelFallback.create({ data: { modelId: primary.model.id, fallbackModelId: fallback.model.id, position: 0 } });
    }
    await moduleRef.get(ModelRegistryService).refresh();
  };

  /** A subscribed user funded with 1 credit, with an agent (with the `toolTypes` tool rows) in their channel. */
  const seed = async (toolTypes: string[] = []) => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id });
    for (const toolType of toolTypes) await prisma.agentTool.create({ data: { agentId: agent.id, toolType } });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    return { user, agent, channel };
  };

  const storedMessages = async () =>
    (await prisma.channelMessage.findMany({ orderBy: { createdAt: "asc" } })).map((m) => [m.role, m.content, m.tokens]);

  const usageEntries = () => prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });

  const offeredToolNames = (requestIndex: number) =>
    (fake.requests[requestIndex].tools ?? []).map((tool: { function: { name: string } }) => tool.function.name);

  it("RNX-16 router fallback (CH): the first attempt answers 503, the fallback model answers, and exactly one provider_error usage entry is written for the failed attempt", async () => {
    await seedModel({ withFallback: true });
    const { user, agent, channel } = await seed();
    fake.enqueue({ error: { code: 503, message: "unavailable" } }, { content: "From fallback", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(actual.content).toBe("From fallback");
    expect(fake.requests.map((r) => r.connection.slug)).toEqual(["test-model", "fallback-model"]);
    const [reservation] = await prisma.creditReservation.findMany();
    const entries = await usageEntries();
    expect(entries.map((e) => [e.agentId, e.runId, e.memberUserId, e.outcome, e.modelId, e.amount.toFixed(6)])).toEqual([
      [agent.id, reservation.runId, user.id, "provider_error", "test-model", "0.000000"],
      [agent.id, reservation.runId, user.id, "completed", "fallback-model", "-0.000015"],
    ]);
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000015"]);
    expect(await storedMessages()).toEqual([
      ["user", "Hi", null],
      ["assistant", "From fallback", 15],
    ]);
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-16 unknown tool name (CH): a call to a name that is neither a built-in nor an MCP tool runs nothing; the next request carries the 'not available' tool result and the run ends with the final answer", async () => {
    await seedModel();
    const { user, agent, channel } = await seed();
    const executeTool = jest.spyOn(moduleRef.get(AgentToolService), "executeTool");
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "send_email", arguments: { to: "x@example.test" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Final answer", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(actual.content).toBe("Final answer");
    expect(offeredToolNames(0)).toEqual(["create_document"]);
    expect(executeTool.mock.calls.map(([name]) => name)).toEqual(["send_email"]);
    expect([mockMcpConnect.mock.calls.length, mockWebSearch.mock.calls.length, mockGenerateDocument.mock.calls.length]).toEqual([0, 0, 0]);
    expect(fake.requests[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: NOT_AVAILABLE });
    expect(fake.requests).toHaveLength(2);
    expect(await storedMessages()).toEqual([
      ["user", "Hi", null],
      ["assistant", "Final answer", 110],
    ]);
  });

  it("RNX-276 built-in tool not offered (CH): the agent was not given calculator, so a call to it runs nothing; the model gets 'not available' (flipped from RNX-16's pin)", async () => {
    await seedModel();
    const { user, agent, channel } = await seed();
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "2+2" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Final answer", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(actual.content).toBe("Final answer");
    expect(offeredToolNames(0)).toEqual(["create_document"]);
    expect(fake.requests[1].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: 'Tool "calculator" is not available. It may require an MCP integration to be connected.',
    });
  });

  it("RNX-276 web_search not offered (CH): a call to it runs no web search; the model gets 'not available' and the run finishes", async () => {
    await seedModel();
    const { user, agent, channel } = await seed();
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "web_search", arguments: { query: "prices" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "Final answer", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(actual.content).toBe("Final answer");
    expect(mockWebSearch.mock.calls.length).toBe(0);
    expect(fake.requests[1].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: 'Tool "web_search" is not available. It may require an MCP integration to be connected.',
    });
    expect(fake.requests).toHaveLength(2);
  });

  it.each(["memory_store", "create_reminder"] as const)(
    "RNX-276 %s not offered (CH): a call to it writes nothing; the model gets 'not available' and the run finishes",
    async (tool) => {
      await seedModel();
      const { user, agent, channel } = await seed();
      fake.enqueue(
        { toolCalls: [{ id: "call_1", name: tool, arguments: {} }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
        { content: "Final answer", usage: { prompt_tokens: 60, completion_tokens: 8 } },
      );

      const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

      expect(actual.content).toBe("Final answer");
      expect(fake.requests[1].messages.at(-1)).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: `Tool "${tool}" is not available. It may require an MCP integration to be connected.`,
      });
      expect(await prisma.reminder.count()).toBe(0);
      expect(await prisma.userMemory.count()).toBe(0);
      expect(mockGenerateDocument.mock.calls.length).toBe(0);
    },
  );

  it("RNX-276 control (CH): a built-in that WAS offered still runs", async () => {
    await seedModel();
    const { user, agent, channel } = await seed(["calculator"]);
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "2+2" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "It is 4.", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(actual.content).toBe("It is 4.");
    expect(offeredToolNames(0)).toEqual(["calculator", "create_document"]);
    expect(fake.requests[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: "Result: 4" });
  });

  it("RNX-16 tool call and follow-up (CH): only the user message and the final answer are stored (no tool messages), and the ledger has one usage entry per model call", async () => {
    await seedModel();
    const { user, agent, channel } = await seed(["calculator"]);
    fake.enqueue(
      { toolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "2+2" } }], usage: { prompt_tokens: 40, completion_tokens: 2 } },
      { content: "It is 4.", usage: { prompt_tokens: 60, completion_tokens: 8 } },
    );

    const actual = await service.chat(user.id, channel.id, agent.id, "Hi");

    expect(actual.content).toBe("It is 4.");
    expect(offeredToolNames(0)).toEqual(["calculator", "create_document"]);
    expect(fake.requests[1].messages.slice(-2)).toEqual([
      expect.objectContaining({ role: "assistant", tool_calls: [expect.objectContaining({ id: "call_1" })] }),
      { role: "tool", tool_call_id: "call_1", content: "Result: 4" },
    ]);
    expect(await storedMessages()).toEqual([
      ["user", "Hi", null],
      ["assistant", "It is 4.", 110],
    ]);
    const [reservation] = await prisma.creditReservation.findMany();
    const entries = await usageEntries();
    expect(entries.map((e) => [e.agentId, e.runId, e.parentCallId, e.outcome, e.tokensNew, e.tokensOut, e.amount.toFixed(6)])).toEqual([
      [agent.id, reservation.runId, null, "completed", 40, 2, "-0.000042"],
      [agent.id, reservation.runId, null, "completed", 60, 8, "-0.000068"],
    ]);
    expect([reservation.status, reservation.consumed.toFixed(6)]).toEqual(["settled", "0.000110"]);
    await assertCreditLedgerInvariants(prisma);
  });
});
