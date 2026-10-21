import { ForbiddenException } from "@nestjs/common";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ChatService } from "../../chat/service/chat.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { DocumentService } from "../../document/service/document.service";
import { CreditService } from "../../billing/service/credit.service";
import { CreditsExhaustedException } from "../../billing/errors/credits-exhausted.exception";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { AgentRunMeterService } from "./agent-run-meter.service";
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
import { AgentLinkService } from "./agent-link.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";

// RX-14: characterization tests for the agent gates (since RX-22b: the
// subscription gate and the ledger; the quota counters are gone) and the
// chat-completion billing path (D106; since RX-22 on the credit ledger: one
// usage entry per call, rounded once). These collaborators load ESM-only
// packages and are stubbed (the pattern of agent-run.agent-lookups.spec.ts).
jest.mock("./agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

describe("RX-14: the agent gates and the chat billing numbers (test database, fake provider)", () => {
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
          AgentLinkService,
          WorkspaceQuotaService,
          AgentRunMeterService,
          PlatformSettingsService,
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
          { provide: WorkspaceKnowledgeService, useValue: {} },
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

  // RX-22b (RNX-193, D190): checkAndDeductQuota and deductTokenQuota are gone from the agent path. What stays is the
  // subscription gate (D192) and, at the old overage gate's place, a ledger read (402 when nothing is available); the
  // run is charged through one reservation and a usage entry per model call. The cases below are the RX-14 cases
  // rewritten to that behaviour; each says what it pinned before.
  describe("the agent gates (through AgentRunService.chat)", () => {
    const subscribedUser = async (overrides: {
      planTokens?: bigint;
      /** Credits on the ledger's paid wallet. */
      credits?: string;
    } = {}) => {
      const plan = await createPlan(prisma, {
        maxTokensPerMonth: overrides.planTokens ?? 1_000_000n,
      });
      const user = await createUser(prisma);
      if (overrides.credits) await fundPaidWallet(prisma, user.id, overrides.credits);
      await createSubscription(prisma, { userId: user.id, planId: plan.id });
      const agent = await createAgent(prisma, { userId: user.id });
      return { user, agent, plan };
    };

    const usageAmountsOf = async (userId: string) =>
      (await prisma.creditLedgerEntry.findMany({ where: { memberUserId: userId, type: "usage" }, orderBy: { seq: "asc" } })).map(
        (e) => e.amount.toFixed(6),
      );

    // Was: messagesUsed +1, no balance change, no ledger row. RNX-186: the counters, User.balance and the Transaction
    // table are gone, so only the ledger is asserted.
    it("active subscription with ledger credits: the chat runs and is one usage entry", async () => {
      const { user, agent } = await subscribedUser({ credits: "1.0" });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const result = await agentRun.chat(user.id, agent.id, "Hi");

      expect(result.message.content).toBe("Hello");
      expect(await usageAmountsOf(user.id)).toEqual(["-0.000015"]);
      await assertCreditLedgerInvariants(prisma);
    });

    // Was: at the token limit with balance 0, BadRequestException "Monthly token limit reached ..." and the
    // messagesUsed increment rolled back. RNX-186: the counters are gone.
    it("no ledger credits: 402 CREDITS_EXHAUSTED before any model call or write", async () => {
      const { user, agent } = await subscribedUser({ planTokens: 1000n });
      // no turn enqueued: the refusal happens before any provider call, and a
      // turn enqueued here would leak to the next test (the fake keeps it)

      await expect(agentRun.chat(user.id, agent.id, "Hi")).rejects.toThrow(CreditsExhaustedException);

      expect(fake.requests).toHaveLength(0);
      expect(await prisma.agentMessage.count()).toBe(0);
    });

    // Unchanged: the agent subscription gate stays (D192, D202 item 8).
    it("no subscription: ForbiddenException, no model call", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, "1.0");
      const agent = await createAgent(prisma, { userId: user.id });

      await expect(agentRun.chat(user.id, agent.id, "Hi")).rejects.toThrow(
        new ForbiddenException("Active subscription required to use AI Agents."),
      );

      expect(fake.requests).toHaveLength(0);
    });
  });

  describe("after a completed run: one usage entry, no token counter (was deductTokenQuota)", () => {
    // Was: tokensUsed increases by the run's 42 tokens (fire-and-forget). RNX-186: the counter is gone.
    it("the run's 30 + 12 tokens are one usage entry of 0.000042", async () => {
      const plan = await createPlan(prisma);
      const user = await createUser(prisma);
      await createSubscription(prisma, { userId: user.id, planId: plan.id });
      await fundPaidWallet(prisma, user.id, "1.0");
      const agent = await createAgent(prisma, { userId: user.id });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 30, completion_tokens: 12 } });

      await agentRun.chat(user.id, agent.id, "Hi");

      const entries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: user.id, type: "usage" } });
      expect(entries.map((e) => [e.amount.toFixed(6), e.tokensNew, e.tokensOut])).toEqual([["-0.000042", 30, 12]]);
      await assertCreditLedgerInvariants(prisma);
    });

    // Was: a run reporting 0 tokens leaves tokensUsed unchanged (early return). RNX-186: the counter is gone.
    it("a run whose usage reports no tokens writes a usage entry of 0", async () => {
      const plan = await createPlan(prisma);
      const user = await createUser(prisma);
      await createSubscription(prisma, { userId: user.id, planId: plan.id });
      await fundPaidWallet(prisma, user.id, "1.0");
      const agent = await createAgent(prisma, { userId: user.id });
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 0, completion_tokens: 0 } });

      await agentRun.chat(user.id, agent.id, "Hi");

      const entries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: user.id, type: "usage" } });
      expect(entries.map((e) => [e.amount.toFixed(6), e.outcome])).toEqual([["0.000000", "completed"]]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("D106: the numbers one chat completion writes (ChatService.createCompletion, real CreditService, fake provider)", () => {
    // RX-22 (D190) rewrote these cases from Transaction rows and User.balance to the credit ledger. Before: a pending
    // reservation row with the estimate, a success row with the actual cost, User.balance moved by two separately
    // rounded UPDATEs (and, at a decimal rate, a 1 micro-credit D106 drift). Now: the user is funded with a plan_grant
    // entry, the reservation is a hold on the account row (no entry), the call writes ONE usage entry whose amount is
    // rounded once, up, to a micro-credit (docs/credits.md section 2.3), and the account balance moves by exactly
    // that amount. RNX-186 removed the Transaction table and User.balance.
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
        { id: userId, email: "u@test.local" },
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
      await assertCreditLedgerInvariants(prisma);
    });
  });
});
