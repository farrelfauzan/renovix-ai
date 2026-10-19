import { Decimal } from "@prisma/client/runtime/client";
import { ChannelChatService } from "./channel-chat.service";

// RX-21 review B2: a channel chat logs its usage cost per 1,000,000 tokens at the
// tier rate. Test doubles only, no database; these collaborators load ESM-only
// packages.
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const RATE_ONE = {
  inputCreditsPerToken: new Decimal(1),
  cachedCreditsPerToken: new Decimal(1),
  outputCreditsPerToken: new Decimal(1),
};

describe("RX-21: ChannelChatService usage log", () => {
  it("logs 1,000 input + 500 output tokens at rate 1 as 0.0015 credits", async () => {
    let resolveLogged!: (entry: { cost: Decimal }) => void;
    const logged = new Promise<{ cost: Decimal }>((resolve) => (resolveLogged = resolve));
    const usage = { logUsage: jest.fn(async (entry: { cost: Decimal }) => resolveLogged(entry)) };
    const registry = { getModel: async () => ({ tier: "standard" }), getTierRates: async () => RATE_ONE };
    const service = new ChannelChatService(
      {} as never,
      registry as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      usage as never,
      {} as never,
    );
    const modelEntry = { slug: "test-model", provider: "openrouter", inputPrice: null, outputPrice: null };

    service["logUsage"]("user-1", modelEntry, 1000, 500, Date.now());
    const entry = await logged;

    expect(entry).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
    expect(entry.cost.toString()).toBe("0.0015");
  });
});
