import { ConfigModule } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { CreditEstimateController } from "./credit-estimate.controller";
import { CreditEstimateService } from "../service/credit-estimate.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { PortalTierService } from "../service/portal-tier.service";
import { CreditService } from "../../billing/service/credit.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { PromptTemplateService } from "../../chat/service/prompt-template.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { UserMemoryService } from "../../memory/service/user-memory.service";
import { DocumentService } from "../../document/service/document.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { SystemKnowledgeService } from "../../knowledge/service/system-knowledge.service";
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

// RNX-331 (D390, D391): POST /chat/portal/credit-estimate on the test database, next to the real PortalController whose
// reservation it must match. The FREE tuning parts run for real (PromptTuningService, PromptTemplateService and
// UserMemoryService on the test database: a seeded system prompt, a matching document template, a user memory); only
// the two PAID knowledge searches are stubs, spied to prove the estimate never calls them. NON-default tier rates (D83):
// a figure computed from the seeded 1 / 1 / 1 would not match. The figures are written out by hand (see EXPECTED_*).
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../knowledge/service/system-knowledge.service", () => ({ SystemKnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx331-test-secret";

const SESSION = "33133133-3313-4331-8331-331331331331";
const STANDARD_MODEL = "rnx331/standard";
const PREMIUM_MODEL = "rnx331/premium";
const FRONTIER_MODEL = "rnx331/frontier";
/** A premium model whose own limit (10000) lets a document template raise max_tokens from 4096 to 8192. */
const WIDE_PREMIUM_MODEL = "rnx331/premium-wide";
const WIDE_MAX_TOKENS = 10000;
const URL = "/chat/portal/credit-estimate";
const ALLOWANCE_SETTING = "knowledgeSearchAllowanceCredits";
/** Not the seed's 0.5, so a hard-coded 0.5 in place of the setting gives another figure. */
const ALLOWANCE = 0.25;
/** Matches the seeded "invoice" document template (keyword "invoice", output format pdf). */
const MESSAGES = [{ role: "user", content: "Draft an invoice" }];
/** Matches no template. */
const PLAIN_MESSAGES = [{ role: "user", content: "Say hello" }];
/** M: the model's maxOutputTokens (1000), below the 4096 (8192 with a document template) a request would ask. */
const MAX_TOKENS = 1000;
// The tuned prompt (one system message, then the user's): the system content is "Be brief." (9 bytes) + "\n\n" +
// "[Invoice Mode]\nWrite an invoice." (32) + "\n\n" + the PDF "[Document Output Rules]" text (339) + "\n\n" +
// "[User Memory Context]\n- Preferences: Short answers" (50) = 436 bytes. I = "system" 6 + 436 + "user" 4 +
// "Draft an invoice" 16 + 4 per message x 2 = 470. Rates are micro-credits per token.
// premium 7 new, 11 cached, 13 out: I x 11 + M x 13 = 5170 + 13000 = 18170 micro-credits
const EXPECTED_PREMIUM = "0.018170";
// frontier 5 new, 3 cached, 17 out: I x 5 + M x 17 = 2350 + 17000 = 19350 micro-credits
const EXPECTED_FRONTIER = "0.019350";
// wide premium, the document template's 8192: 470 x 11 + 8192 x 13 = 5170 + 106496 = 111666 micro-credits
const EXPECTED_WIDE_TEMPLATE = "0.111666";
// wide premium, no template (4096): I = 6 + ("Be brief." 9 + 2 + memory 50) + 4 + "Say hello" 9 + 8 = 88;
// 88 x 11 + 4096 x 13 = 968 + 53248 = 54216 micro-credits
const EXPECTED_WIDE_PLAIN = "0.054216";

describe("RNX-331: POST /chat/portal/credit-estimate (Fastify, test database)", () => {
  const fake = new FakeProviderAdapter();
  const searchSystemKB = jest.fn(async () => []);
  const searchChunks = jest.fn(async () => []);
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
          PlatformSettingsService,
          PortalTierService,
          CreditService,
          CreditEstimateService,
          ModelRegistryService,
          PromptTuningService,
          PromptTemplateService,
          UserMemoryService,
          { provide: SystemKnowledgeService, useValue: { searchSystemKB } },
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
          {
            provide: ConversationService,
            useValue: { getOrCreateConversation: async () => "conversation-id", saveMessages: async () => undefined, generateTitle: async () => undefined },
          },
          { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [], searchChunks } },
          { provide: DocumentService, useValue: { generateWithStorage: async () => ({ format: "pdf", url: "u", filename: "f.pdf", expiresAt: null }) } },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = await createFastifyApp(moduleRef);
  });

  // The same system prompt and template in every test: both services cache what they read for 60 seconds.
  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    searchSystemKB.mockClear();
    searchChunks.mockClear();
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
    await createResolvableModel(prisma, { slug: WIDE_PREMIUM_MODEL, tier: "premium", maxOutputTokens: WIDE_MAX_TOKENS });
    await moduleRef.get(ModelRegistryService).refresh();
    await prisma.systemPrompt.create({ data: { name: "base", content: "Be brief." } });
    await prisma.promptTemplate.create({
      data: { slug: "invoice", name: "Invoice", description: "invoice", content: "Write an invoice.", keywords: ["invoice"], priority: 1, outputFormat: "pdf" },
    });
    await prisma.platformSetting.create({ data: { name: ALLOWANCE_SETTING, value: ALLOWANCE } });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** A signed-in user with 5 paid credits, a package that allows the given tiers and one memory. */
  const userWith = async (allowedTiers: string[]) => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    await createPackageSnapshot(prisma, { userId: user.id, allowedTiers });
    await prisma.userMemory.create({ data: { userId: user.id, type: "preference", content: "Short answers", confidence: 0.9 } });
    return user;
  };

  /** A knowledge base (the user's, or the system's without a user) with one chunk. */
  const knowledgeChunkOf = (owner: { userId: string | null; isSystem: boolean }) =>
    prisma.knowledgeBase.create({
      data: {
        ...owner,
        name: "kb",
        chunks: { create: { content: "chunk", tokenCount: 1, embeddingModel: "test-model", embeddedAt: new Date() } },
      },
    });

  const estimate = (user: { id: string; email: string }, payload: object, url = URL) =>
    app.inject({ method: "POST", url, headers: asSessionUser(user), payload });

  const send = (user: { id: string; email: string }, model: string, messages = MESSAGES) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": SESSION, ...asSessionUser(user) },
      payload: { model, messages },
    });

  /** The amount the one reservation on the test database holds, six decimals. */
  const heldCredits = async () => {
    const [reservation] = await prisma.creditReservation.findMany({ select: { amountHeld: true } });
    return reservation.amountHeld.toFixed(6);
  };

  describe("AC1: N is the send's estimate on the free-tuned prompt plus the allowance per knowledge search that can run", () => {
    it.each([
      ["premium", PREMIUM_MODEL, EXPECTED_PREMIUM],
      ["frontier", FRONTIER_MODEL, EXPECTED_FRONTIER],
    ])("%s, no knowledge to search: the route's figure is the written-out worst case and equals the real reservation's hold", async (_tier, model, expectedCredits) => {
      const inputUser = await userWith(["standard", "premium", "frontier"]);
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const actualEstimate = await estimate(inputUser, { model, messages: MESSAGES });
      const actualSend = await send(inputUser, model);

      expect(actualEstimate.statusCode).toBe(200);
      expect(actualEstimate.json()).toEqual({ credits: expectedCredits });
      expect(actualSend.body).toContain("data: [DONE]");
      expect(await heldCredits()).toBe(expectedCredits);
    });

    it.each([
      ["neither knowledge base has a chunk: 0 searches", { user: false, system: false }, "0.018170"],
      ["only the user's knowledge base has a chunk: 1 search", { user: true, system: false }, "0.268170"],
      ["only the system knowledge base has a chunk: 1 search", { user: false, system: true }, "0.268170"],
      ["both have a chunk: 2 searches", { user: true, system: true }, "0.518170"],
    ])("%s; N = the real reservation's hold + 0.25 per search", async (_case, knowledge, expectedCredits) => {
      const inputUser = await userWith(["standard", "premium"]);
      if (knowledge.user) await knowledgeChunkOf({ userId: inputUser.id, isSystem: false });
      if (knowledge.system) await knowledgeChunkOf({ userId: null, isSystem: true });
      const searches = Number(knowledge.user) + Number(knowledge.system);
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const actualEstimate = await estimate(inputUser, { model: PREMIUM_MODEL, messages: MESSAGES });
      expect(searchSystemKB).not.toHaveBeenCalled();
      expect(searchChunks).not.toHaveBeenCalled();
      await send(inputUser, PREMIUM_MODEL);

      expect(actualEstimate.json()).toEqual({ credits: expectedCredits });
      expect(Number(actualEstimate.json().credits)).toBeCloseTo(Number(await heldCredits()) + ALLOWANCE * searches, 6);
      expect(searchSystemKB).toHaveBeenCalledTimes(1);
      expect(searchChunks).toHaveBeenCalledTimes(1);
    });

    it("another user's knowledge chunk does not count as this user's search", async () => {
      const inputUser = await userWith(["standard", "premium"]);
      const otherUser = await createUser(prisma);
      await knowledgeChunkOf({ userId: otherUser.id, isSystem: false });

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: MESSAGES });

      expect(actual.json()).toEqual({ credits: EXPECTED_PREMIUM });
    });

    it("a document template raises the output limit as the send does: 8192 with the template, 4096 without, both equal to the real hold", async () => {
      const inputUser = await userWith(["standard", "premium"]);
      fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

      const actualTemplate = await estimate(inputUser, { model: WIDE_PREMIUM_MODEL, messages: MESSAGES });
      const actualPlain = await estimate(inputUser, { model: WIDE_PREMIUM_MODEL, messages: PLAIN_MESSAGES });
      await send(inputUser, WIDE_PREMIUM_MODEL);

      expect(actualTemplate.json()).toEqual({ credits: EXPECTED_WIDE_TEMPLATE });
      expect(actualPlain.json()).toEqual({ credits: EXPECTED_WIDE_PLAIN });
      expect(await heldCredits()).toBe(EXPECTED_WIDE_TEMPLATE);
    });

    it("the allowance setting is not set: 200 with no figure, one log line naming the setting, no tuning and no search", async () => {
      const inputUser = await userWith(["standard", "premium"]);
      await knowledgeChunkOf({ userId: null, isSystem: true });
      await prisma.platformSetting.delete({ where: { name: ALLOWANCE_SETTING } });
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: MESSAGES });

      expect(actual.statusCode).toBe(200);
      expect(actual.json()).toEqual({ credits: null });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(ALLOWANCE_SETTING);
      expect(warn.mock.calls[0][0]).not.toContain("Draft an invoice");
    });

    it("the figure grows with the message: a longer prompt counts more input tokens", async () => {
      const inputUser = await userWith(["standard", "premium"]);
      const longMessages = [{ role: "user", content: "x".repeat(4000) }];

      const actualShort = await estimate(inputUser, { model: PREMIUM_MODEL, messages: PLAIN_MESSAGES });
      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: longMessages });

      expect(Number(actual.json().credits)).toBeGreaterThan(Number(actualShort.json().credits) + 0.04);
    });

    it("the estimate holds nothing, writes nothing and makes no paid call: no reservation, no ledger row, no provider call, no knowledge search", async () => {
      const inputUser = await userWith(["standard", "premium"]);
      await knowledgeChunkOf({ userId: inputUser.id, isSystem: false });
      await knowledgeChunkOf({ userId: null, isSystem: true });
      const expectedLedgerRows = await prisma.creditLedgerEntry.count();

      const actual = await estimate(inputUser, { model: PREMIUM_MODEL, messages: MESSAGES });

      expect(actual.statusCode).toBe(200);
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await prisma.creditLedgerEntry.count()).toBe(expectedLedgerRows);
      expect(fake.requests).toHaveLength(0);
      expect(searchSystemKB).not.toHaveBeenCalled();
      expect(searchChunks).not.toHaveBeenCalled();
    });

    it("an account whose balance is below the worst case still gets the worst case (the figure is not capped by the balance)", async () => {
      const inputUser = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: inputUser.id, allowedTiers: ["standard", "premium"] });
      await prisma.userMemory.create({ data: { userId: inputUser.id, type: "preference", content: "Short answers", confidence: 0.9 } });

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
