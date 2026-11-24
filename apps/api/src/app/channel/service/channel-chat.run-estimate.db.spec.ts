import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentRunService } from "../../agent/service/agent-run.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { rememberOfferedTools } from "../../agent/utils/remember-offered-tools";
import type { McpRunSession } from "../../agent/types/mcp-run-session";
import type { ToolSchema } from "../../agent/types/tool-schema";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ProvidersModule } from "../../providers/providers.module";
import type { ChatRequest } from "../../providers/provider.interface";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { setPeerRunLimits } from "../../../../test/peer-run-limits";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-351 AC2: a channel chat and an agent run of the same agent, model and input reserve the same RNX-327 estimate
// (docs/credits.md section 13.3): (L + 1) root calls + min(peerRunMaxModelCalls, 15) calls per linked agent at its own
// rates. Each root call is the run's own first request (the channel's prompt is not the agent run's), so each
// reservation is checked against its own root call and the linked agents' share is compared between the two and
// against a figure worked out by hand. Real ChannelChatService, AgentRunService, links, meter and ledger on the test
// database; fake provider. Non-default numbers: the root on 2 / 1 / 3 micro-credits per token (standard), the helper on
// 7 / 5 / 11 (premium), peerRunMaxAgentCalls 2 and peerRunMaxModelCalls 4. These collaborators load ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const toolSchema = (name: string): ToolSchema => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } }) as ToolSchema;

describe("RNX-351: the channel chat reserves the agent run's estimate (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  const tools = {
    buildToolSchemasWithMcp: jest.fn(async (_tools: unknown, _agentId: string, _userId: string, _workspaceId: string, options: { injectCallAgent?: boolean; mcpSession: McpRunSession }) => {
      const schemas = [toolSchema("lookup"), ...(options.injectCallAgent ? [toolSchema("call_agent")] : [])];
      rememberOfferedTools(options.mcpSession, schemas);
      return schemas;
    }),
    executeTool: jest.fn(async () => "result"),
    cleanupMcpConnections: jest.fn(async () => undefined),
  };
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let channelChat: ChannelChatService;
  let agentRun: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          ChannelService,
          AgentRunService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          { provide: AgentToolService, useValue: tools },
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined } },
          { provide: KnowledgeService, useValue: {} },
          { provide: WorkspaceKnowledgeService, useValue: {} },
          {
            provide: GuardrailService,
            useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    channelChat = moduleRef.get(ChannelChatService);
    agentRun = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await setPeerRunLimits(prisma, { maxDepth: 2, maxAgentCalls: 2, callTimeoutSeconds: 45, maxModelCalls: 4 });
    fake.requests.length = 0;
    jest.clearAllMocks();
    await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await createResolvableModel(prisma, { slug: "helper-model", modelName: "helper-model", tier: "premium", maxTokens: 8192 });
    await prisma.tierRate.createMany({
      data: [
        { tier: "standard", inputCreditsPerToken: 2, cachedCreditsPerToken: 1, outputCreditsPerToken: 3 },
        { tier: "premium", inputCreditsPerToken: 7, cachedCreditsPerToken: 5, outputCreditsPerToken: 11 },
      ],
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A subscribed, funded user with an agent (max_tokens 100) linked to one helper (premium), the agent in their channel. */
  const seed = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id, status: "active", maxTokens: 100 });
    const helper = await createAgent(prisma, { userId: user.id, name: "Helper", status: "active", model: "helper-model", systemPrompt: "Helper.", maxTokens: 1_000 });
    await prisma.agentLink.create({ data: { callerAgentId: agent.id, calleeAgentId: helper.id } });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    return { user, agent, channel };
  };

  /** Runs `send` answered at once; the reservation's minimum (the estimate, under the 10-credit cap) and the root's first request. */
  const reserveOnce = async (send: () => Promise<unknown>) => {
    const reserveRun = jest.spyOn(moduleRef.get(CreditService), "reserveRun");
    const firstRequest = fake.requests.length;
    fake.enqueue({ content: "Done", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    await send();
    const minimum = reserveRun.mock.calls[0][0].minimum;
    reserveRun.mockRestore();
    return { minimum, first: fake.requests[firstRequest] };
  };

  /** The root's E_call (section 3.1 rule 1): its counted prompt (messages and tools) x max(2, 1) + max_tokens 100 x 3. */
  const rootCallOf = (first: ChatRequest) => new Decimal(countPromptTokens(first.messages, first.tools ?? []) * 2 + 100 * 3).div(1_000_000);

  it("AC2: the same agent, model and input through the channel chat and through an agent run: both reservations are RNX-327's estimate, with the same linked agents' share", async () => {
    const { user, agent, channel } = await seed();

    const viaChannel = await reserveOnce(() => channelChat.chat(user.id, channel.id, agent.id, "Hi"));
    const viaAgentRun = await reserveOnce(() => agentRun.chat(user.id, agent.id, "Hi"));

    // L = min(1 link, peerRunMaxAgentCalls 2) = 1, n = min(peerRunMaxModelCalls 4, 15) = 4: 2 x E_call(root) + 4 x E_call(helper).
    // The helper's prompt "system" + "Helper." = 13 bytes + 4 per message = 17 tokens: 17 x max(7, 5) + 1,000 x 11 = 11,119;
    // 4 x 11,119 = 44,476 micro-credits = 0.044476.
    const expectedLinkedShare = "0.044476";
    const linkedShareOf = ({ minimum, first }: { minimum: Decimal; first: ChatRequest }) => minimum.minus(rootCallOf(first).times(2)).toFixed(6);
    expect([linkedShareOf(viaChannel), linkedShareOf(viaAgentRun)]).toEqual([expectedLinkedShare, expectedLinkedShare]);
  });
});
