import { Decimal } from "@prisma/client/runtime/client";
import { AgentRunService } from "./agent-run.service";
import { testConnection } from "../../../../test/provider-model";

// RX-21 review B2: the streamed agent run logs its usage cost per 1,000,000 tokens
// at the tier rate. Test doubles only, no database; these collaborators load
// ESM-only packages.
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const RATE_ONE = {
  inputCreditsPerToken: new Decimal(1),
  cachedCreditsPerToken: new Decimal(1),
  outputCreditsPerToken: new Decimal(1),
};

describe("RX-21: AgentRunService.streamExecution usage log", () => {
  it("logs 1,000 input + 500 output tokens at rate 1 as 0.0015 credits", async () => {
    let resolveLogged!: (entry: { cost: Decimal }) => void;
    const logged = new Promise<{ cost: Decimal }>((resolve) => (resolveLogged = resolve));
    const usage = { logUsage: jest.fn(async (entry: { cost: Decimal }) => resolveLogged(entry)) };
    const registry = { getModel: async () => ({ tier: "standard" }), getTierRates: async () => RATE_ONE };
    const prisma = { agentMessage: { create: async () => ({}) } };
    const router = {
      chatStream: async function* () {
        yield JSON.stringify({
          choices: [{ delta: { content: "ok" } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        });
      },
    };
    const service = new AgentRunService(
      prisma as never,
      registry as never,
      router as never,
      {} as never,
      {} as never,
      {} as never,
      usage as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const context = {
      agentId: "agent-1",
      userId: "user-1",
      systemPrompt: "",
      model: "test-model",
      connection: testConnection(),
      temperature: 0.7,
      tools: [],
      knowledgeBaseIds: [],
    };

    for await (const _event of service.streamExecution(context, [], [], "run-1", { agentType: "standalone" })) {
      // drain the stream
    }
    const entry = await logged;

    expect(entry).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
    expect(entry.cost.toString()).toBe("0.0015");
  });
});
