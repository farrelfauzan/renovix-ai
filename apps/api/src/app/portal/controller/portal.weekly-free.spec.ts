import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { CreditWallet } from "@generated/prisma/client.js";
import type { Decimal } from "@prisma/client/runtime/client";
import { PortalController } from "./portal.controller";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PortalTierService } from "../service/portal-tier.service";
import { CreditService } from "../../billing/service/credit.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { DocumentService } from "../../document/service/document.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { fundWeeklyFreeWallet } from "../../../../test/fund-weekly-free-wallet";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-58a: the signed-in home chat's paid path (POST /chat/portal/completions) spends the weekly_free wallet before
// paid credits on a Standard-tier model only (D5); every other tier is paid only. Fake provider, test database.
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx58a-test-secret";

const SESSION = "58a58a58-58a5-458a-858a-58a58a58a58a";
const MODEL_OF_TIER: Record<string, string> = {
  standard: "rnx58a/portal-standard",
  advanced: "rnx58a/portal-advanced",
  premium: "rnx58a/portal-premium",
  frontier: "rnx58a/portal-frontier",
};

describe("RNX-58a: the home chat spends weekly_free before paid on Standard models only (Fastify, test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  // RNX-340: what the home chat writes to usage_logs; replaced before each test, called through a stable wrapper.
  let logUsage: jest.Mock<Promise<void>, [{ cost: Decimal }]>;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [PortalController],
        providers: [
          EntitlementService,
          PortalTierService,
          CreditService,
          ModelRegistryService,
          {
            provide: PromptTuningService,
            useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
          },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
          {
            provide: ConversationService,
            useValue: { getOrCreateConversation: async () => "conversation-id", saveMessages: async () => undefined, generateTitle: async () => undefined },
          },
          { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
          { provide: DocumentService, useValue: {} },
          { provide: UsageService, useValue: { logUsage: (params: { cost: Decimal }) => logUsage(params) } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    logUsage = jest.fn(async (_params: { cost: Decimal }) => undefined);
    fake.requests.length = 0;
    for (const [tier, slug] of Object.entries(MODEL_OF_TIER)) {
      await prisma.tierRate.create({ data: { tier, inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
      await createResolvableModel(prisma, { slug, tier, maxTokens: 8192 });
    }
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await assertCreditLedgerInvariants(prisma);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A signed-in user with `weeklyFree` and `paid` credits and a package allowing every tier. */
  const signedUpUser = async (weeklyFree: string, paid: string) => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id, allowedTiers: Object.keys(MODEL_OF_TIER) });
    await fundWeeklyFreeWallet(prisma, user.id, weeklyFree);
    await fundPaidWallet(prisma, user.id, paid);
    return user;
  };

  const chat = (user: { id: string; email: string }, model: string) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": SESSION, ...asSessionUser(user) },
      payload: { model, messages: [{ role: "user", content: "Hi" }] },
    });

  /** One wallet's balance and held, as fixed strings. */
  const walletOf = async (userId: string, wallet: CreditWallet) => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet } } });
    return { balance: account.balance.toFixed(6), held: account.held.toFixed(6) };
  };

  /** The usage entries as [wallet, amount], and the reservations as [wallet, status]. */
  const ledgerOf = async () => ({
    usage: (await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } })).map((e) => [e.wallet, e.amount.toFixed(6)]),
    reservations: (await prisma.creditReservation.findMany()).map((r) => [r.wallet, r.status]),
  });

  it("AC1: 2 weekly_free and paid credit, a home chat on a Standard model: the hold and the usage are on weekly_free, paid is unchanged", async () => {
    const user = await signedUpUser("2", "5");
    const reserve = jest.spyOn(CreditService.prototype, "reserve");
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const res = await chat(user, MODEL_OF_TIER.standard);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("data: [DONE]");
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve.mock.calls[0][0]).toMatchObject({ userId: user.id, spendsWeeklyFree: true });
    expect(await ledgerOf()).toEqual({ usage: [["weekly_free", "-0.000015"]], reservations: [["weekly_free", "settled"]] });
    expect(await walletOf(user.id, "weekly_free")).toEqual({ balance: "1.999985", held: "0.000000" });
    expect(await walletOf(user.id, "paid")).toEqual({ balance: "5.000000", held: "0.000000" });
  });

  // RNX-340: the usage_logs cost of a home chat is the call's charge across both wallets. Rates are 1/1/1 and the fake
  // provider reports 10 + 5 tokens, so the call costs 0.000015 credit. Expected values are written out.
  describe("RNX-340: the usage_logs cost is the call's total charge", () => {
    /** The usage entries as [wallet, amount, balanceAfter, uncharged], weekly_free first. */
    const entriesOf = async () =>
      (await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: [{ wallet: "desc" }, { seq: "asc" }] })).map((e) => [
        e.wallet,
        e.amount.toFixed(6),
        e.balanceAfter.toFixed(6),
        e.uncharged.toFixed(6),
      ]);

    it("AC1: 0.00001 weekly_free and 5 paid, a Standard call of 0.000015: cost is 0.000015 (0.00001 free + 0.000005 paid)", async () => {
      const user = await signedUpUser("0.00001", "5");
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const res = await chat(user, MODEL_OF_TIER.standard);

      expect(res.statusCode).toBe(200);
      expect(logUsage).toHaveBeenCalledTimes(1);
      expect(logUsage.mock.calls[0][0].cost.toFixed(6)).toBe("0.000015");
      expect(await entriesOf()).toEqual([
        ["weekly_free", "-0.000010", "0.000000", "0.000000"],
        ["paid", "-0.000005", "4.999995", "0.000000"],
      ]);
      expect(await walletOf(user.id, "weekly_free")).toEqual({ balance: "0.000000", held: "0.000000" });
      expect(await walletOf(user.id, "paid")).toEqual({ balance: "4.999995", held: "0.000000" });
    });

    it("AC2: 2 weekly_free, a Standard call of 0.000015: cost is 0.000015, paid is unchanged", async () => {
      const user = await signedUpUser("2", "5");
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const res = await chat(user, MODEL_OF_TIER.standard);

      expect(res.statusCode).toBe(200);
      expect(logUsage.mock.calls[0][0].cost.toFixed(6)).toBe("0.000015");
      expect(await entriesOf()).toEqual([["weekly_free", "-0.000015", "1.999985", "0.000000"]]);
      expect(await walletOf(user.id, "weekly_free")).toEqual({ balance: "1.999985", held: "0.000000" });
      expect(await walletOf(user.id, "paid")).toEqual({ balance: "5.000000", held: "0.000000" });
    });

    it("AC3: a Premium call of 0.000015 (paid only): cost is 0.000015, weekly_free is unchanged", async () => {
      const user = await signedUpUser("2", "5");
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const res = await chat(user, MODEL_OF_TIER.premium);

      expect(res.statusCode).toBe(200);
      expect(logUsage.mock.calls[0][0].cost.toFixed(6)).toBe("0.000015");
      expect(await entriesOf()).toEqual([["paid", "-0.000015", "4.999985", "0.000000"]]);
      expect(await walletOf(user.id, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
      expect(await walletOf(user.id, "paid")).toEqual({ balance: "4.999985", held: "0.000000" });
    });
  });

  it("the pre-check counts weekly_free too: paid alone cannot cover the estimate, weekly_free can: answered and charged to weekly_free", async () => {
    const user = await signedUpUser("2", "0.000001");
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const res = await chat(user, MODEL_OF_TIER.standard);

    expect(res.statusCode).toBe(200);
    expect(await ledgerOf()).toEqual({ usage: [["weekly_free", "-0.000015"]], reservations: [["weekly_free", "settled"]] });
    expect(await walletOf(user.id, "paid")).toEqual({ balance: "0.000001", held: "0.000000" });
  });

  it.each(["premium", "frontier", "advanced"])(
    "AC3: a home chat on a %s model reserves paid only; weekly_free is not used",
    async (tier) => {
      const user = await signedUpUser("2", "5");
      const reserve = jest.spyOn(CreditService.prototype, "reserve");
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const res = await chat(user, MODEL_OF_TIER[tier]);

      expect(res.statusCode).toBe(200);
      expect(reserve.mock.calls[0][0]).toMatchObject({ userId: user.id, spendsWeeklyFree: false });
      expect(await ledgerOf()).toEqual({ usage: [["paid", "-0.000015"]], reservations: [["paid", "settled"]] });
      expect(await walletOf(user.id, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
      expect(await walletOf(user.id, "paid")).toEqual({ balance: "4.999985", held: "0.000000" });
    },
  );

  it("AC3 negative: a Premium model whose estimate paid cannot cover is refused with 402 even with weekly_free credit; nothing written", async () => {
    const user = await signedUpUser("2", "0.000001");

    const res = await chat(user, MODEL_OF_TIER.premium);

    expect(res.statusCode).toBe(402);
    expect(await ledgerOf()).toEqual({ usage: [], reservations: [] });
    expect(fake.requests).toHaveLength(0);
  });
});
