import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
import { ProvidersModule } from "../../providers/providers.module";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import type { PrismaService } from "../../prisma/prisma.service";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RX-21 review B2 (test database, real UsageService and ModelRegistryService, fake provider): an agent
// run writes usage_logs.cost = tokens x tier rate / 1,000,000 (docs/credits.md section 1.3). Without
// the divide the cost is 10^6 too high, and a large Frontier run overflows usage_logs.cost
// Decimal(12,6), so the row is lost. Based on QA's RX-21 repro. Since RX-22b the row is written per
// model call with the credits of that call's usage entry (one row per run before), so the user is
// funded on the ledger. These collaborators load ESM-only packages and are stubbed (the pattern of
// agent-run.billing-characterization.spec.ts).
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const LOG_WAIT_MS = 3_000;
const LOG_POLL_MS = 50;

describe("RX-21: usage_logs.cost of an agent run (test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: Awaited<ReturnType<typeof createTestModule>>["moduleRef"];
  let prisma: PrismaService;
  let runs: AgentRunService;
  let registry: ModelRegistryService;

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
          UsageService,
          {
            provide: AgentToolService,
            useValue: {
              buildToolSchemasWithMcp: async () => [],
              cleanupMcpConnections: async () => undefined,
            },
          },
          {
            provide: AgentMemoryService,
            useValue: { getMemoryContext: async () => "", extractAndStore: async () => undefined },
          },
          { provide: KnowledgeService, useValue: {} },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
        ],
      },
      (builder) => withFakeProvider(builder, fake),
    ));
    runs = moduleRef.get(AgentRunService);
    registry = moduleRef.get(ModelRegistryService);
  });

  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  /** Seeds one model of `tier` at `rate` credits per 1,000,000 tokens and runs one agent chat. */
  const runAgent = async (input: { tier: string; rate: number; promptTokens: number; completionTokens: number }) => {
    await prisma.tierRate.create({
      data: {
        tier: input.tier,
        inputCreditsPerToken: input.rate,
        cachedCreditsPerToken: input.rate,
        outputCreditsPerToken: input.rate,
      },
    });
    await createResolvableModel(prisma, {
      slug: "test-model",
      modelName: "test-model",
      inputPrice: 0.000001,
      outputPrice: 0.000002,
      maxTokens: 8192,
      tier: input.tier,
    });
    await registry.refresh();
    const plan = await createPlan(prisma, { maxTokensPerMonth: 1_000_000_000n });
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "10");
    const agent = await createAgent(prisma, { userId: user.id });
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: input.promptTokens, completion_tokens: input.completionTokens } });
    await runs.chat(user.id, agent.id, "Hi");
    return user.id;
  };

  /** Waits up to LOG_WAIT_MS for the user's usage_logs rows (the run awaits the write since RX-22b). */
  const usageLogsOf = async (userId: string) => {
    const deadline = Date.now() + LOG_WAIT_MS;
    let logs = await prisma.usageLog.findMany({ where: { userId } });
    while (logs.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LOG_POLL_MS));
      logs = await prisma.usageLog.findMany({ where: { userId } });
    }
    return logs;
  };

  it("10 input + 5 output tokens at standard 1/1/1 log cost 0.000015", async () => {
    const userId = await runAgent({ tier: "standard", rate: 1, promptTokens: 10, completionTokens: 5 });

    const logs = await usageLogsOf(userId);

    expect(logs).toHaveLength(1);
    expect(logs[0].cost.toFixed(6)).toBe("0.000015");
    const [entry] = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: userId, type: "usage" } });
    expect(entry.amount.toFixed(6)).toBe("-0.000015");
  });

  it("40,000 input + 100 output tokens at frontier 29 write a row with cost 1.1629 (no Decimal(12,6) overflow)", async () => {
    const userId = await runAgent({ tier: "frontier", rate: 29, promptTokens: 40_000, completionTokens: 100 });

    const logs = await usageLogsOf(userId);

    expect(logs).toHaveLength(1);
    expect(logs[0].cost.toFixed(6)).toBe("1.162900");
  });
});
