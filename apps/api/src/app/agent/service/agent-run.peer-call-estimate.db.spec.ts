import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { AgentRunService } from "./agent-run.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentLinkService } from "./agent-link.service";
import { AgentRunPolicyService } from "./agent-run-policy.service";
import { rememberOfferedTools } from "../utils/remember-offered-tools";
import type { McpRunSession } from "../types/mcp-run-session";
import type { ToolSchema } from "../types/tool-schema";
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
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-327: the pre-run estimate of an agent run (on the chat engine) counts each linked agent's own model calls, its
// tool loop included, at its own rates, capped by peerRunMaxModelCalls (docs/credits.md section 13.3); without the
// peerRunMaxAgentCalls row no call_agent is offered and no called agent is counted (no value in code). Real
// AgentRunService, links, meter and ledger on the test database; fake provider. Non-default numbers: the root agent's
// model at 2 / 1 / 3 micro-credits per token (standard), the helper's at 7 / 5 / 11 (premium), peerRunMaxAgentCalls 3
// and peerRunMaxModelCalls 7. These collaborators load ESM-only packages.
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));

const toolSchema = (name: string): ToolSchema => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } }) as ToolSchema;

describe("RNX-327: the peer-call reservation estimate of an agent run (test database, fake provider)", () => {
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
  let service: AgentRunService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
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
          { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined } },
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
    service = moduleRef.get(AgentRunService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await setPeerRunLimits(prisma, { maxDepth: 2, maxAgentCalls: 3, callTimeoutSeconds: 45, maxModelCalls: 7 });
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

  /** Bob, subscribed and funded, with his own agent (max_tokens 100) and, with `link`, a linked helper on the premium model. */
  const seed = async ({ link = true } = {}) => {
    const bob = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: bob.id });
    await fundPaidWallet(prisma, bob.id, "1");
    const agent = await createAgent(prisma, { userId: bob.id, status: "active", maxTokens: 100 });
    const helper = await createAgent(prisma, { userId: bob.id, name: "Bob helper", status: "active", model: "helper-model", systemPrompt: "Helper.", maxTokens: 1_000 });
    if (link) await prisma.agentLink.create({ data: { callerAgentId: agent.id, calleeAgentId: helper.id } });
    return { bob, agent };
  };

  /** Runs one message answered at once and returns the reservation's minimum (the estimate under the 10-credit cap) and the root's first request. */
  const runOnce = async (userId: string, agentId: string) => {
    const reserveRun = jest.spyOn(moduleRef.get(CreditService), "reserveRun");
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    await service.chat(userId, agentId, "Hi");
    return { minimum: reserveRun.mock.calls[0][0].minimum, first: fake.requests[0] };
  };

  /** The root's E_call, as the meter counts it (section 3.1 rule 1): its counted prompt x max(2, 1) + max_tokens 100 x 3. */
  const rootCallOf = (first: ChatRequest) => new Decimal(countPromptTokens(first.messages, first.tools ?? []) * 2 + 100 * 3).div(1_000_000);

  const offeredToolNames = (first: ChatRequest) => (first.tools ?? []).map((tool) => (tool as ToolSchema).function.name);

  it("AC1: the estimate counts the helper's model calls up to peerRunMaxModelCalls (7), at the helper's own rates", async () => {
    const { bob, agent } = await seed();

    const actual = await runOnce(bob.id, agent.id);

    // One helper call: its prompt "system" + "Helper." = 13 bytes + 4 per message = 17 tokens; 17 x max(7, 5) +
    // 1,000 (its max_tokens) x 11 = 11,119 micro-credits. L = min(1 link, 3) = 1: 2 root calls + 7 x 0.011119 = 0.077833.
    const expected = rootCallOf(actual.first).times(2).plus("0.077833");
    expect(actual.minimum.toFixed(6)).toBe(expected.toFixed(6));
  });

  it("AC1: a peerRunMaxModelCalls above the tool loop's 15 rounds counts 15 helper calls", async () => {
    await prisma.platformSetting.update({ where: { name: "peerRunMaxModelCalls" }, data: { value: 40 } });
    const { bob, agent } = await seed();

    const actual = await runOnce(bob.id, agent.id);

    // 15 x 0.011119 = 0.166785.
    expect(actual.minimum.toFixed(6)).toBe(rootCallOf(actual.first).times(2).plus("0.166785").toFixed(6));
  });

  it("AC3: without the peerRunMaxAgentCalls row, no call_agent is offered, no called agent is counted, and a log line names the setting", async () => {
    await prisma.platformSetting.delete({ where: { name: "peerRunMaxAgentCalls" } });
    const { bob, agent } = await seed();
    const { lines } = captureLogLines();

    const actual = await runOnce(bob.id, agent.id);

    expect(offeredToolNames(actual.first)).toEqual(["lookup"]);
    expect(tools.buildToolSchemasWithMcp.mock.calls.map((call) => call[4].injectCallAgent)).toEqual([false]);
    expect(actual.minimum.toFixed(6)).toBe(rootCallOf(actual.first).toFixed(6));
    expect(lines.filter((line) => line.includes("peerRunMaxAgentCalls is not set"))).toHaveLength(1);
  });

  it("control: with the row, the same run offers call_agent", async () => {
    const { bob, agent } = await seed();

    const actual = await runOnce(bob.id, agent.id);

    expect(offeredToolNames(actual.first)).toEqual(["lookup", "call_agent"]);
  });

  it("without the peerRunMaxModelCalls row, no called agent is counted (no agent call can run) and a log line names the setting", async () => {
    await prisma.platformSetting.delete({ where: { name: "peerRunMaxModelCalls" } });
    const { bob, agent } = await seed();
    const { lines } = captureLogLines();

    const actual = await runOnce(bob.id, agent.id);

    expect(actual.minimum.toFixed(6)).toBe(rootCallOf(actual.first).toFixed(6));
    expect(lines.filter((line) => line.includes("peerRunMaxModelCalls is not set"))).toHaveLength(1);
  });

  it("a run without linked agents reads no agent-call setting: no log line when the rows are missing", async () => {
    await prisma.platformSetting.deleteMany({ where: { name: { in: ["peerRunMaxAgentCalls", "peerRunMaxModelCalls"] } } });
    const { bob, agent } = await seed({ link: false });
    const { lines } = captureLogLines();

    const actual = await runOnce(bob.id, agent.id);

    expect(actual.minimum.toFixed(6)).toBe(rootCallOf(actual.first).toFixed(6));
    expect(lines.filter((line) => line.includes("is not set"))).toEqual([]);
  });
});
