import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { CreditEstimateController } from "./credit-estimate.controller";
import { CreditEstimateService } from "../service/credit-estimate.service";
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
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-331: POST /chat/portal/credit-estimate on the test database, next to the real PortalController whose
// reservation it must match. NON-default tier rates (D83): a figure computed from the seeded 1 / 1 / 1 would not match.
// The prompt, rates and max_tokens below give the expected figures written out by hand (see EXPECTED_*).
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx331-test-secret";

const SESSION = "33133133-3313-4331-8331-331331331331";
const STANDARD_MODEL = "rnx331/standard";
const PREMIUM_MODEL = "rnx331/premium";
const FRONTIER_MODEL = "rnx331/frontier";
const URL = "/chat/portal/credit-estimate";
const MESSAGES = [{ role: "user", content: "Estimate this message" }];
/** M: the model's maxOutputTokens (1000), below the 4096 a request that names no max_tokens would ask. */
const MAX_TOKENS = 1000;
// Rates are micro-credits per token; I = 29 (the prompt's UTF-8 bytes, "user" + "Estimate this message" = 25, plus 4 per message). premium 7 new, 11 cached, 13 out: I x 11 + M x 13 = 319 + 13000 = 13319 micro-credits
const EXPECTED_PREMIUM = "0.013319";
// frontier 5 new, 3 cached, 17 out: I x 5 + M x 17 = 145 + 17000 = 17145 micro-credits
const EXPECTED_FRONTIER = "0.017145";

describe("RNX-331: POST /chat/portal/credit-estimate (Fastify, test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [PortalController, CreditEstimateController],
        providers: [
          EntitlementService,
          PortalTierService,
          CreditService,
          CreditEstimateService,
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
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await prisma.tierRate.createMany({
      data: [
        { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
        { tier: "premium", inputCreditsPerToken: 7, cachedCreditsPerToken: 11, outputCreditsPerToken: 13 },
        { tier: "frontier", inputCreditsPerToken: 5, cachedCreditsPerToken: 3, outputCreditsPerToken: 17 },
      ],
    });
    for (const [slug, tier] of [[STANDARD_MODEL, "standard"], [PREMIUM_MODEL, "premium"], [FRONTIER_MODEL, "frontier"]]) {
      await createResolvableModel(prisma, { slug, tier, maxOutputTokens: MAX_TOKENS });
    }
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** A signed-in user with 5 paid credits and a package that allows the given tiers. */
  const userWith = async (allowedTiers: string[]) => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    await createPackageSnapshot(prisma, { userId: user.id, allowedTiers });
    return user;
  };

  const estimate = (user: { id: string; email: string }, payload: object, url = URL) =>
    app.inject({ method: "POST", url, headers: asSessionUser(user), payload });

  const send = (user: { id: string; email: string }, model: string) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": SESSION, ...asSessionUser(user) },
      payload: { model, messages: MESSAGES },
    });

  describe("AC1: N is what the reservation holds for the same message and model", () => {
    it.each([
      ["premium", PREMIUM_MODEL, EXPECTED_PREMIUM],
      ["frontier", FRONTIER_MODEL, EXPECTED_FRONTIER],
    ])("%s: the route's figure is the written-out worst case and equals the real reservation's hold", async (_tier, model, expectedCredits) => {
      const inputUser = await userWith(["standard", "premium", "frontier"]);
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const actualEstimate = await estimate(inputUser, { model, messages: MESSAGES });
      const actualSend = await send(inputUser, model);

      expect(actualEstimate.statusCode).toBe(200);
      expect(actualEstimate.json()).toEqual({ credits: expectedCredits });
      expect(actualSend.body).toContain("data: [DONE]");
      const [reservation] = await prisma.creditReservation.findMany({ select: { amountHeld: true } });
      expect(reservation.amountHeld.toFixed(6)).toBe(expectedCredits);
      expect(actualEstimate.json().credits).toBe(reservation.amountHeld.toFixed(6));
    });

    it("the figure grows with the message: a longer prompt counts more input tokens", async () => {
      const inputUser = await userWith(["standard", "premium"]);
      const longMessages = [{ role: "user", content: "x".repeat(4000) }];

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: longMessages });

      expect(Number(actual.json().credits)).toBeGreaterThan(Number(EXPECTED_PREMIUM) + 0.04);
    });

    it("the estimate holds nothing and writes nothing: no reservation, no ledger row, no provider call", async () => {
      const inputUser = await userWith(["standard", "premium"]);
      const expectedLedgerRows = await prisma.creditLedgerEntry.count();

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: MESSAGES });

      expect(actual.statusCode).toBe(200);
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await prisma.creditLedgerEntry.count()).toBe(expectedLedgerRows);
      expect(fake.requests).toHaveLength(0);
    });

    it("an account whose balance is below the worst case still gets the worst case (the figure is not capped by the balance)", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["standard", "premium"] });

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: MESSAGES });

      expect(actual.json()).toEqual({ credits: EXPECTED_PREMIUM });
    });
  });

  describe("AC3: the route answers for the signed-in account and the models it may use", () => {
    it("no session: 401, nothing computed", async () => {
      const actual = await app.inject({ method: "POST", url: URL, payload: { model: PREMIUM_MODEL, messages: MESSAGES } });

      expect(actual.statusCode).toBe(401);
    });

    it("a model the packages do not allow: refused with 400 PACKAGE_LIMIT_REACHED, no figure", async () => {
      const inputUser = await userWith(["standard"]);

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: MESSAGES });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error).toEqual({ type: "PACKAGE_LIMIT_REACHED", feature: "tier", requested: ["premium"], nextPackage: null });
      expect(actual.body).not.toContain("credits");
    });

    it("an unknown model: 400", async () => {
      const inputUser = await userWith(["standard", "premium"]);

      const actual = await estimate(inputUser, { model: "rnx331/none", messages: MESSAGES });

      expect(actual.statusCode).toBe(400);
    });

    it("a forged user or account id (body, query, header) has no effect: a user without the tier is refused whoever the request names", async () => {
      const owner = await userWith(["standard", "premium"]);
      const intruder = await userWith(["standard"]);
      const forged = { userId: owner.id, accountId: owner.id, user: { userId: owner.id } };

      const actual = await app.inject({
        method: "POST",
        url: `${URL}?userId=${owner.id}&accountId=${owner.id}`,
        headers: { ...asSessionUser(intruder), "x-user-id": owner.id },
        payload: { model: PREMIUM_MODEL, messages: MESSAGES, ...forged },
      });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error.type).toBe("PACKAGE_LIMIT_REACHED");
    });

    it("a forged id on an entitled user's request does not change the answer", async () => {
      const owner = await userWith(["standard", "premium"]);
      const intruder = await userWith(["standard"]);

      const actual = await estimate(owner, { model: PREMIUM_MODEL, messages: MESSAGES, userId: intruder.id });

      expect(actual.json()).toEqual({ credits: EXPECTED_PREMIUM });
    });

    it("an invalid body: 400 with the one invalid-body shape", async () => {
      const inputUser = await userWith(["standard", "premium"]);

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: "hello" });

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error.type).toBe("invalid_request_error");
    });
  });
});
