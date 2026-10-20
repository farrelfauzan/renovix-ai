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
import { CreditService } from "../../billing/service/credit.service";
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
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import type { PrismaService } from "../../prisma/prisma.service";
import { createResolvableModel } from "../../../../test/provider-model";

// RX-14: characterization tests for the agent quota path
// (checkAndDeductQuota / deductTokenQuota via AgentRunService.chat) and the
// chat-completion billing path (D106; since RX-22 on the credit ledger: one
// usage entry per call, rounded once). The agent quota cases pin TODAY's
// numbers (they change with RX-22b). These collaborators load ESM-only
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
          CreditService,
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
    await createResolvableModel(prisma, {
      slug: "test-model",
      modelName: "test-model",
      inputPrice: 0.000001,
      outputPrice: 0.000002,
      maxTokens: 8192,
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
      /** Credits on the ledger's paid wallet (RX-22 review: the overage gate reads the ledger, not User.balance). */
      credits?: string;
    } = {}) => {
      const plan = await createPlan(prisma, {
        maxTokensPerMonth: overrides.planTokens ?? 1_000_000n,
      });
      const user = await createUser(prisma, { balance: overrides.balance ?? new Decimal(0) });
      if (overrides.credits) await fundPaidWallet(prisma, user.id, overrides.credits);
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

    // RX-22 review (D208): the overage allowance reads the ledger's paid wallet (balance - held); was User.balance 1.0.
    it("at the token limit with ledger credits: allowed (overage), messagesUsed +1, balance untouched by the quota check", async () => {
      const { user, agent } = await subscribedUser({
        planTokens: 1000n,
        tokensUsed: 1000n,
        balance: new Decimal("1.0"),
        credits: "1.0",
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

    it("RX-22 review: at the token limit with User.balance 1.0 but no ledger credits: refused (User.balance is not read)", async () => {
      const { user, agent } = await subscribedUser({
        planTokens: 1000n,
        tokensUsed: 1000n,
        balance: new Decimal("1.0"),
      });

      await expect(agentRun.chat(user.id, agent.id, "Hi")).rejects.toThrow(
        new BadRequestException(
          "Monthly token limit reached and insufficient credit balance for overage. Please upgrade or top up.",
        ),
      );

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

  describe("D106: the numbers one chat completion writes (ChatService.createCompletion, real CreditService, fake provider)", () => {
    // RX-22 (D190) rewrote these cases from Transaction rows and User.balance to the credit ledger. Before: a pending
    // reservation row with the estimate, a success row with the actual cost, User.balance moved by two separately
    // rounded UPDATEs (and, at a decimal rate, a 1 micro-credit D106 drift). Now: the user is funded with a plan_grant
    // entry, the reservation is a hold on the account row (no entry), the call writes ONE usage entry whose amount is
    // rounded once, up, to a micro-credit (docs/credits.md section 2.3), and the account balance moves by exactly
    // that amount. No Transaction row is written and User.balance stays 0.
    // Usage 2 + 115 = 117 tokens at the standard rate 1/1/1 -> 0.000117 credits.
    const fundedUser = async (credits: string) => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, credits);
      return user;
    };

    const complete = (userId: string, model = "test-model") =>
      chat.createCompletion(
        {
          model,
          messages: [{ role: "user", content: "Hi" }],
          store: false,
        },
        { id: userId, email: "u@test.local", balance: new Decimal(0) },
      );

    /** The user's ledger entries (type, amount, balanceAfter), the paid account (balance, held) and the reservations. */
    const ledgerOf = async (userId: string) => {
      const entries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: userId }, orderBy: { seq: "asc" } });
      const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });
      const reservations = await prisma.creditReservation.findMany({ where: { accountId: account.id } });
      return {
        entries: entries.map((e) => [e.type, e.amount.toFixed(6), e.balanceAfter.toFixed(6)]),
        account: [account.balance.toFixed(6), account.held.toFixed(6)],
        reservations: reservations.map((r) => [r.status, r.consumed.toFixed(6)]),
      };
    };

    /** Nothing of the old path is written: no Transaction row, User.balance unchanged at 0. */
    const expectOldPathUntouched = async (userId: string) => {
      expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
      expect((await balanceOf(userId)).toFixed(6)).toBe("0.000000");
    };

    it("one completion: one usage entry with the actual cost, the account balance moves by exactly that, the hold is settled", async () => {
      const user = await fundedUser("1.0");
      fake.enqueue({ content: "Hello world", usage: { prompt_tokens: 2, completion_tokens: 115 } });

      await complete(user.id);

      expect(await ledgerOf(user.id)).toEqual({
        entries: [
          ["bonus", "1.000000", "1.000000"],
          ["usage", "-0.000117", "0.999883"],
        ],
        account: ["0.999883", "0.000000"],
        reservations: [["settled", "0.000117"]],
      });
      await expectOldPathUntouched(user.id);
      await assertCreditLedgerInvariants(prisma);
    });

    it("the D106 scenario after RX-22: the deepseek-v4-flash request charges by tokens and tier rate; entry and balance agree; nothing double-counted", async () => {
      // The model row the D106 finding used (deepseek-v4-flash prices): provider prices do not enter the charge.
      // Before RX-22 the never-settled pending row double-counted the reservation (sum -0.000118 vs delta 0.000117);
      // a hold is not an entry, so the sum of entries now equals the balance.
      await createResolvableModel(prisma, {
        slug: "d106-model",
        modelName: "d106-model",
        inputPrice: 0.0000000983,
        outputPrice: 0.0000001966,
        maxTokens: 8192,
      });
      await registry.refresh();
      const user = await fundedUser("1.0");
      fake.enqueue({ content: "Hello world", usage: { prompt_tokens: 2, completion_tokens: 115 } });

      await complete(user.id, "d106-model");

      const ledger = await ledgerOf(user.id);
      expect(ledger.entries).toEqual([
        ["bonus", "1.000000", "1.000000"],
        ["usage", "-0.000117", "0.999883"],
      ]);
      expect(ledger.account).toEqual(["0.999883", "0.000000"]);
      await expectOldPathUntouched(user.id);
      await assertCreditLedgerInvariants(prisma);
    });

    // Was "OPEN D106 (RX-22 target)": at the decimal rate 0.5 the old path wrote a success row of -0.000002 while the
    // balance lost 0.000001. RX-22 rounds once per call, up, on the exact sum: (2 + 1) x 0.5 = 1.5 micro-credits ->
    // 2 micro-credits; the entry and the balance agree.
    it("D106 fixed (RX-22): with a decimal rate 0.5, 3 tokens cost 1.5 micro-credits, charged as 2 once; entry and balance agree", async () => {
      await prisma.tierRate.update({
        where: { tier: "standard" },
        data: { inputCreditsPerToken: 0.5, cachedCreditsPerToken: 0.5, outputCreditsPerToken: 0.5 },
      });
      await registry.refresh();
      const user = await fundedUser("1.0");
      fake.enqueue({ content: "Hello world", usage: { prompt_tokens: 2, completion_tokens: 1 } });

      await complete(user.id);

      expect(await ledgerOf(user.id)).toEqual({
        entries: [
          ["bonus", "1.000000", "1.000000"],
          ["usage", "-0.000002", "0.999998"],
        ],
        account: ["0.999998", "0.000000"],
        reservations: [["settled", "0.000002"]],
      });
      await expectOldPathUntouched(user.id);
      await assertCreditLedgerInvariants(prisma);
    });
  });
});
