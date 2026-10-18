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
    // The model row: input 0.000001, output 0.000002, creditMultiplier 1
    // (the AiModel default). ModelRegistryService doubles the prices for the
    // user (markup_multiplier defaults to 2 when no AppConfig row exists),
    // and pricing.inputPrice.toNumber() hands the JS double 0.000002 to
    // estimateCost/calculateActualCost.
    //
    // With the message "Hi" (2 chars): estimateTokens = ceil(2/4) = 1, so
    // estimatedCost = 1 x 0.000002 = 0.000002 exactly. But `users.balance`
    // and `transactions.amount` are numeric(12,6): the reservation UPDATE
    // subtracts 0.000002 and Postgres rounds it to 0.000002 -> the balance
    // stays 1.000000 - 0.000002 = 0.999998, while the pending ledger row
    // stores ROUND(-0.000002, 6) = -0.000002... at six decimals both are
    // exact here. The 1-ulp story shows with the actual cost: the provider
    // usage (prompt 2, completion 115) makes actualCost =
    // 2x0.000002 + 115x0.000004 = 0.000464 exactly (no rounding), so this
    // scenario pins the mechanism (pending row rounds to 6dp separately from
    // the balance arithmetic) with clean numbers. The exact D106 pair
    // (-0.000045 balance vs -0.000046 ledger) is reproduced below with the
    // seed's deepseek-v4-flash prices and a one-token estimate.
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

      // estimatedCost = 1 token x 0.000002 = 0.000002; round6(-0.000002) = -0.000002
      expect(ledger[0].type).toBe("deduction");
      expect(ledger[0].status).toBe("pending");
      expect(ledger[0].amount.toFixed(6)).toBe("-0.000002");

      // actualCost = 2x0.000002 + 115x0.000004 = 0.000464
      expect(ledger[1].type).toBe("deduction");
      expect(ledger[1].status).toBe("success");
      expect(ledger[1].amount.toFixed(6)).toBe("-0.000464");

      // balance: 1.0 - 0.000002 (reserve, rounded to 6dp) - 0.000462 (extra) = 0.999536
      // which is 0.000464 less than 1.0 — sum(ledger) here, because both costs are exact at 6dp
      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.999536");
    });

    it("the exact D106 pair: balance loses 0.000045 while the success ledger row says -0.000046 (deepseek-v4-flash prices, one-token estimate)", async () => {
      // The seed's deepseek-v4-flash: input 0.0000000983, output 0.0000001966,
      // creditMultiplier 1. Doubled for the user: 0.0000001966 / 0.0000003932.
      // pricing.inputPrice.toNumber() = 1.966e-7 — a JS double that is not the
      // exact decimal 0.0000001966, which is where the two computations drift.
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

      // estimate: 1 token x 1.966e-7 = 0.0000001966; the pending row rounds to 6dp: 0
      // (QA saw a pending deduction row with amount 0 written first — that is this)
      expect(ledger[0].type).toBe("deduction");
      expect(ledger[0].status).toBe("pending");
      expect(ledger[0].amount.toFixed(6)).toBe("0.000000");

      // actual: 2x1.966e-7 + 115x3.932e-7 = 0.0000456112; the success row rounds to -0.000046
      expect(ledger[1].type).toBe("deduction");
      expect(ledger[1].status).toBe("success");
      expect(ledger[1].amount.toFixed(6)).toBe("-0.000046");

      // balance: 1.0 - round6(0.0000001966) - round6(0.0000454146)
      //        = 1.0 - 0.000000      - 0.000045    = 0.999955 (lost 0.000045)
      // sum(ledger) = 0 + (-0.000046) = -0.000046. Balance and ledger differ by 0.000001.
      expect((await balanceOf(user.id)).toFixed(6)).toBe("0.999955");
      const ledgerSum = ledger.reduce((sum, row) => sum.add(row.amount), new Decimal(0));
      expect(ledgerSum.toFixed(6)).toBe("-0.000046");
      // the 1-ulp difference QA saw (D106):
      expect(new Decimal("1.0").sub(await balanceOf(user.id)).toFixed(6)).toBe("0.000045");
    });
  });
});
