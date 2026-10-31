import { TestingModule } from "@nestjs/testing";
import { AgentRunService } from "./agent-run.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { AgentLinkService } from "./agent-link.service";
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
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPackageSnapshot, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { AgentRunPolicyService } from "./agent-run-policy.service";

// RNX-162 AC8: the agent meter (AgentRunMeterService.callModel) writes one model_call_costs row per model call of a
// run, root and hop, right after each usage entry, with the run's workspace. Real AgentRunService, meter and
// CreditService on the test database; fake provider. These collaborators load ESM-only packages.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const CALL_AGENT = { type: "function", function: { name: "call_agent", description: "Call", parameters: {} } };

describe("RNX-162: model call costs on the agent meter (test database, fake provider)", () => {
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
              buildToolSchemasWithMcp: async (
                _tools: unknown,
                _agentId: string,
                _userId?: string,
                _workspaceId?: string,
                options?: { injectCallAgent?: boolean },
              ) => (options?.injectCallAgent ? [CALL_AGENT] : []),
              cleanupMcpConnections: async () => undefined,
            },
          },
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
    fake.requests.length = 0;
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
  });

  afterAll(() => moduleRef?.close());

  it("AC8 agent-meter path: root call, hop and root answer each get a row for their call id, with the run's workspace", async () => {
    const { provider } = await createResolvableModel(prisma, { slug: "test-model", modelName: "test-model", maxTokens: 8192 });
    await moduleRef.get(ModelRegistryService).refresh();
    const bob = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: bob.id });
    await fundPaidWallet(prisma, bob.id, "1");
    const parent = await createAgent(prisma, { userId: bob.id, status: "active" });
    const sub = await createAgent(prisma, { userId: bob.id, name: "Bob helper", status: "active" });
    await prisma.agentLink.create({ data: { callerAgentId: parent.id, calleeAgentId: sub.id } });
    fake.enqueue(
      { toolCalls: [{ name: "call_agent", arguments: { agent: sub.id, task: "do it" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } },
      { content: "Sub answer", usage: { prompt_tokens: 50, completion_tokens: 20 } },
      { content: "Parent final", usage: { prompt_tokens: 200, completion_tokens: 30 } },
    );

    const result = await service.chat(bob.id, parent.id, "Hi");

    expect(result.message.content).toBe("Parent final");
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: { seq: "asc" } });
    const rows = await prisma.modelCallCost.findMany();
    const rowOf = (callId: string | null) => rows.find((r) => r.callId === callId);
    expect(rows).toHaveLength(3);
    // createModel's prices: 0.000001 USD per input token, 0.000002 per output token.
    expect(entries.map((e) => [e.agentId, rowOf(e.callId)?.workspaceId, rowOf(e.callId)?.providerId, rowOf(e.callId)?.tokenPriceUsd?.toFixed(6)])).toEqual([
      [parent.id, parent.workspaceId, provider.id, "0.000120"],
      [sub.id, parent.workspaceId, provider.id, "0.000090"],
      [parent.id, parent.workspaceId, provider.id, "0.000260"],
    ]);
  });
});
