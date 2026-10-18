import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ChatService } from "../../chat/service/chat.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { DocumentService } from "../../document/service/document.service";
import { BillingService } from "../../billing/service/billing.service";
import { ProvidersModule } from "../../providers/providers.module";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  createAgent,
  createPlan,
  createSubscription,
  createUser,
} from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import type { PrismaService } from "../../prisma/prisma.service";

// RX-14: characterization tests for the agent quota path
// (checkAndDeductQuota / deductTokenQuota via AgentRunService.chat) and the
// chat-completion billing path (D106: the pending-amount-0 + rounded success
// row vs the balance's own rounding). They pin TODAY's numbers so the billing
// rewrite (RX-19/20/22) shows as a diff. These collaborators load ESM-only
// packages and are stubbed (the pattern of agent-run.agent-lookups.spec.ts).
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

describe("RX-14: the agent quota path and the chat billing numbers (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: Awaited<ReturnType<typeof createTestModule>>["moduleRef"];
  let prisma: PrismaService;
  let agentRun: AgentRunService;
  let chat: ChatService;
  let registry: ModelRegistryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          AgentRunService,
          ChatService,
          BillingService,
          ModelRegistryService,
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
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
          {
            provide: GuardrailService,
            useValue: {
              checkInput: async () => ({ blocked: false }),
              checkOutput: async (content: string) => ({ blocked: false, content }),
            },
          },
          {
            provide: PromptTuningService,
            useValue: {
              applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
            },
          },
          { provide: ConversationService, useValue: {} },
          { provide: DocumentService, useValue: {} },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    agentRun = moduleRef.get(AgentRunService);
    chat = moduleRef.get(ChatService);
    registry = moduleRef.get(ModelRegistryService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await prisma.aiModel.create({
      data: {
        slug: "test-model",
        modelName: "test-model",
        providerId: "vendor/test-model",
        inputPrice: 0.000001,
        outputPrice: 0.000002,
        maxTokens: 8192,
      },
    });
    // RX-21: charging reads the tier rate table (credits per 1,000,000 tokens). Seed the
    // standard rate 1/1/1 so the completion path can charge; the D106 numbers below are
    // updated to what the tier-rate path writes (the price x multiplier story is gone).
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await registry.refresh();
  });

  afterAll(() => moduleRef?.close());

  const balanceOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } })).balance;

  describe("checkAndDeductQuota (through AgentRunService.chat)", () => {
    const subscribedUser = async (overrides: {
      planTokens?: bigint;
      tokensUsed?: bigint;
      balance?: Decimal;
    } = {}) => {
      const plan = await createPlan(prisma, {
        maxTokensPerMonth: overrides.planTokens ?? 1_000_000n,
      });
      const user = await createUser(prisma, { balance: overrides.balance ?? new Decimal(0) });
      await createSubscription(prisma, {
        userId: user.id,
        planId: plan.id,
        ...(overrides.tokensUsed !== undefined && { tokensUsed: overrides.tokensUsed }),
      });
      const agent = await createAgent(prisma, { userId: user.id });
      return { user, agent, plan };
    };

    it("active subscription, tokens under the limit: the chat runs, messagesUsed +1, no balance change, no ledger row", async () => {
      const { user, agent } = await subscribedUser({ balance: new Decimal("1.0") });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const result = await agentRun.chat(user.id, agent.id, "Hi");

      expect(result.message.content).toBe("Hello");
      const sub = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
      expect(sub.messagesUsed).toBe(1);
      expect((await balanceOf(user.id)).toFixed(6)).toBe("1.000000");
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    });

    it("at the token limit with a positive balance: allowed (overage), messagesUsed +1, balance untouched by the quota check", async () => {
      const { user, agent } = await subscribedUser({
        planTokens: 1000n,
        tokensUsed: 1000n,
        balance: new Decimal("1.0"),
      });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      await agentRun.chat(user.id, agent.id, "Hi");

      const sub = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
      expect(sub.messagesUsed).toBe(1);
      expect((await balanceOf(user.id)).toFixed(6)).toBe("1.000000");
      // the quota path writes no ledger row and takes no credits either
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(0);
    });

    it("at the token limit with balance 0: BadRequestException, and the messagesUsed increment is ROLLED BACK (the throw happens inside the $transaction)", async () => {
      const { user, agent } = await subscribedUser({
        planTokens: 1000n,
        tokensUsed: 1000n,
        balance: new Decimal(0),
      });
      // no turn enqueued: the refusal happens before any provider call, and a
      // turn enqueued here would leak to the next test (the fake keeps it)

      await expect(agentRun.chat(user.id, agent.id, "Hi")).rejects.toThrow(
        new BadRequestException(
          "Monthly token limit reached and insufficient credit balance for overage. Please upgrade or top up.",
        ),
      );

      const sub = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
      expect(sub.messagesUsed).toBe(0);
      expect(fake.requests).toHaveLength(0);
    });

    it("no subscription: ForbiddenException, no model call", async () => {
      const user = await createUser(prisma);
      const agent = await createAgent(prisma, { userId: user.id });

      await expect(agentRun.chat(user.id, agent.id, "Hi")).rejects.toThrow(
        new ForbiddenException("Active subscription required to use AI Agents."),
      );

      expect(fake.requests).toHaveLength(0);
    });
  });

  describe("deductTokenQuota (after a completed chat, fire-and-forget)", () => {
    it("tokensUsed increases by the actual total tokens of the run", async () => {
      const plan = await createPlan(prisma);
      const user = await createUser(prisma);
      await createSubscription(prisma, { userId: user.id, planId: plan.id, tokensUsed: 0n });
      const agent = await createAgent(prisma, { userId: user.id });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 30, completion_tokens: 12 } });

      await agentRun.chat(user.id, agent.id, "Hi");

      // deductTokenQuota runs async; wait for the quota write to land
      await new Promise((r) => setTimeout(r, 50));
      const sub = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
      expect(sub.tokensUsed).toBe(42n);
    });

    it("a run whose usage reports no tokens (totalTokens 0) leaves tokensUsed unchanged (early return)", async () => {
      const plan = await createPlan(prisma);
      const user = await createUser(prisma);
      await createSubscription(prisma, { userId: user.id, planId: plan.id, tokensUsed: 5n });
      const agent = await createAgent(prisma, { userId: user.id });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 0, completion_tokens: 0 } });

      await agentRun.chat(user.id, agent.id, "Hi");

      await new Promise((r) => setTimeout(r, 50));
      const sub = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
      expect(sub.tokensUsed).toBe(5n);
    });
  });

  describe("D106: the numbers one chat completion writes (ChatService.createCompletion, real BillingService, fake provider)", () => {
    // RX-21 rewrote the charging path: credits = tokens x tier rate / 1,000,000 (docs/credits.md
    // section 1.3), the tier rate seeded above as standard 1/1/1. The old D106 story (price x
    // markup x creditMultiplier with three divergent roundings) is gone: the estimate is the
    // estimated token count x 1 / 1,000,000, the actual is (input + output) x 1 / 1,000,000, and
    // the ledger's pending and success rows now agree with the balance to the micro-credit.
    // estimateTokens("Hi") = ceil(2/4) = 1 token -> 0.000001 credit; usage 2 + 115 = 117 tokens
    // -> 0.000117 credits.
    const userWith = async (balance: string) => createUser(prisma, { balance: new Decimal(balance) });

    const complete = (userId: string) =>
      chat.createCompletion(
        {
          model: "test-model",
          messages: [{ role: "user", content: "Hi" }],
          store: false,
        },
        { id: userId, email: "u@test.local", balance: new Decimal(0) },
      );

    it("one completion: pending row with the ROUNDED estimate, success row with the actual cost, balance = 1 - round6(est) - round6(est - actual)", async () => {
      const user = await userWith("1.0");
      fake.enqueue({ content: "Hello world", usage: { prompt_tokens: 2, completion_tokens: 115 } });

      await complete(user.id);

      const ledger = await prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });
      expect(ledger).toHaveLength(2);

      // estimatedCost = 1 token x rate 1 / 1,000,000 = 0.000001
      expect(ledger[0].type).toBe("deduction");
      expect(ledger[0].status).toBe("pending");
      expect(ledger[0].amount.toFixed(6)).toBe("-0.000001");

      // actualCost = (2 input + 115 output) x rate 1 / 1,000,000 = 0.000117
      expect(ledger[1].type).toBe("deduction");
      expect(ledger[1].status).toBe("success");
      expect(ledger[1].amount.toFixed(6)).toBe("-0.000117");

      // balance: 1.0 - 0.000001 (reserve) - 0.000116 (extra) = 0.999883 — and sum(ledger)
      // (-0.000117) now equals the balance delta to the micro-credit: the 1-ulp D106 drift is gone.
      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.999883");
    });

    it("the D106 scenario after RX-21: the same deepseek-v4-flash request charges by tokens and tier rate, and the ledger agrees with the balance", async () => {
      // The same model row the D106 finding used (deepseek-v4-flash prices) — under RX-21 the
      // provider prices no longer enter the charge at all: credits = tokens x tier rate / 1,000,000
      // with the standard 1/1/1 rate seeded above. The 1-ulp divergence (pending 0, success
      // -0.000046, balance -0.000045) is gone: estimate 1 token -> 0.000001; actual 2 + 115 = 117
      // tokens -> 0.000117; the balance delta and sum(ledger) both say 0.000117.
      await prisma.aiModel.create({
        data: {
          slug: "d106-model",
          modelName: "d106-model",
          providerId: "vendor/d106-model",
          inputPrice: 0.0000000983,
          outputPrice: 0.0000001966,
          maxTokens: 8192,
        },
      });
      await registry.refresh();

      const user = await userWith("1.0");
      fake.enqueue({ content: "Hello world", usage: { prompt_tokens: 2, completion_tokens: 115 } });

      await chat.createCompletion(
        {
          model: "d106-model",
          messages: [{ role: "user", content: "Hi" }],
          store: false,
        },
        { id: user.id, email: "u@test.local", balance: new Decimal(0) },
      );

      const ledger = await prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });
      expect(ledger).toHaveLength(2);

      // estimate: 1 token x 1 / 1,000,000 = 0.000001 (no longer rounds to 0)
      expect(ledger[0].status).toBe("pending");
      expect(ledger[0].amount.toFixed(6)).toBe("-0.000001");

      // actual: 117 tokens x 1 / 1,000,000 = 0.000117
      expect(ledger[1].status).toBe("success");
      expect(ledger[1].amount.toFixed(6)).toBe("-0.000117");

      // balance: 1.0 - 0.000001 - 0.000116 = 0.999883; delta = 0.000117. The D106 ROUNDING
      // divergence is gone (every amount is now an exact micro-credit multiple). What remains is
      // the RX-14 finding #1 behaviour, still true by design: the pending row is never settled,
      // so sum(ledger) (-0.000001 + -0.000117 = -0.000118) double-counts the reservation next to
      // the success row. The BALANCE and the success row agree to the micro-credit (0.000117).
      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.999883");
      const ledgerSum = ledger.reduce((sum, row) => sum.add(row.amount), new Decimal(0));
      expect(ledgerSum.toFixed(6)).toBe("-0.000118");
      expect(new Decimal("1.0").sub(await balanceOf(user.id)).toFixed(6)).toBe("0.000117");
    });
  });
});
