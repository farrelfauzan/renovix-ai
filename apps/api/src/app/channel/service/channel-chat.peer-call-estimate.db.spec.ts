import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { ChannelChatService } from "./channel-chat.service";
import { ChannelService } from "./channel.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { AgentRunMeterService } from "../../agent/service/agent-run-meter.service";
import { AgentLinkService } from "../../agent/service/agent-link.service";
import { AgentRunPolicyService } from "../../agent/service/agent-run-policy.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
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
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-327 AC2: a channel chat keeps main's pre-run estimate (docs/credits.md section 13.3): one call per linked agent,
// (L + 1) root calls, peerRunMaxModelCalls not read; without the peerRunMaxAgentCalls row (no value in code) no called
// agent is counted. Real ChannelChatService, links, meter and ledger on the test database; fake provider. Non-default
// numbers: the root and the writer on 2 / 1 / 3 micro-credits per token (standard), the helper on 7 / 5 / 11 (premium),
// peerRunMaxAgentCalls 1 and peerRunMaxModelCalls 9. These collaborators load ESM-only packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const ECHO = { type: "function", function: { name: "echo", description: "Echo", parameters: {} } };

describe("RNX-327: the channel chat's reservation estimate, as on main (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: ChannelChatService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChannelChatService,
          AgentRunPolicyService,
          AgentLinkService,
          WorkspaceQuotaService,
          ChannelService,
          AgentRunMeterService,
          CreditService,
          PlatformSettingsService,
          ModelRegistryService,
          UsageService,
          {
            provide: AgentToolService,
            useValue: { buildToolSchemasWithMcp: async () => [ECHO], executeTool: async () => "echo result", cleanupMcpConnections: async () => undefined },
          },
          { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "", extractAndStore: async () => undefined } },
          {
            provide: GuardrailService,
            useValue: { checkInput: async () => ({ blocked: false }), checkOutput: async (content: string) => ({ blocked: false, content }) },
          },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    service = moduleRef.get(ChannelChatService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await setPeerRunLimits(prisma, { maxDepth: 2, maxAgentCalls: 1, callTimeoutSeconds: 45, maxModelCalls: 9 });
    fake.requests.length = 0;
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

  /** A subscribed, funded user with an agent (max_tokens 100) in a channel, linked to a helper (premium) and a writer (standard). */
  const seed = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id, status: "active", maxTokens: 100 });
    const helper = await createAgent(prisma, { userId: user.id, name: "Helper", status: "active", model: "helper-model", systemPrompt: "Helper.", maxTokens: 1_000 });
    const writer = await createAgent(prisma, { userId: user.id, name: "Writer", status: "active", systemPrompt: "Writer.", maxTokens: 2_000 });
    await prisma.agentLink.createMany({ data: [helper, writer].map((callee) => ({ callerAgentId: agent.id, calleeAgentId: callee.id })) });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    return { user, agent, channel };
  };

  /** Sends one message answered at once; the reservation's minimum (the estimate, under the 10-credit cap) and the root's first request. */
  const chatOnce = async ({ user, agent, channel }: Awaited<ReturnType<typeof seed>>) => {
    const reserveRun = jest.spyOn(moduleRef.get(CreditService), "reserveRun");
    fake.enqueue({ content: "Done", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    await service.chat(user.id, channel.id, agent.id, "Hi");
    return { minimum: reserveRun.mock.calls[0][0].minimum, first: fake.requests[0] };
  };

  /** The root's E_call (section 3.1 rule 1): its counted prompt (messages and tools) x max(2, 1) + max_tokens 100 x 3. */
  const rootCallOf = (first: ChatRequest) => new Decimal(countPromptTokens(first.messages, first.tools ?? []) * 2 + 100 * 3).div(1_000_000);

  it("AC2: a channel chat with links holds what main holds: (L + 1) root calls + one call per linked agent at its rates", async () => {
    const seeded = await seed();

    const actual = await chatOnce(seeded);

    // Main: L = min(2 links, peerRunMaxAgentCalls 1) = 1, so 2 x E_call(root) + E_call(helper) + E_call(writer).
    // Each prompt is "system" + "Helper." or "Writer." = 13 bytes + 4 per message = 17 tokens.
    // Helper: 17 x max(7, 5) + 1,000 x 11 = 11,119; writer: 17 x max(2, 1) + 2,000 x 3 = 6,034; together 0.017153.
    expect(actual.minimum.toFixed(6)).toBe(rootCallOf(actual.first).times(2).plus("0.017153").toFixed(6));
  });

  it("without the peerRunMaxAgentCalls row, no called agent is counted and a log line names the setting", async () => {
    await prisma.platformSetting.delete({ where: { name: "peerRunMaxAgentCalls" } });
    const seeded = await seed();
    const { lines } = captureLogLines();

    const actual = await chatOnce(seeded);

    expect(actual.minimum.toFixed(6)).toBe(rootCallOf(actual.first).toFixed(6));
    expect(lines.filter((line) => line.includes("peerRunMaxAgentCalls is not set"))).toHaveLength(1);
  });
});
