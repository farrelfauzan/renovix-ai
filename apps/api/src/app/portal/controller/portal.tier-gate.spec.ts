import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
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
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-76 B2b (Q6): the signed-in web chat (POST /chat/portal/completions) refuses a model of a tier the account's
// packages do not allow with 400 PACKAGE_LIMIT_REACHED, before any credit check or reservation, so a refused request
// reserves nothing and writes no ledger row. The cheapest tier is every account's (Q1). Fake provider, test database.
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx76-test-secret";

const SESSION = "76767676-7676-4767-8767-767676767676";
const STANDARD_MODEL = "rnx76/portal-standard";
const PREMIUM_MODEL = "rnx76/portal-premium";

describe("RNX-76 B2b: the web chat's model tier gate (Fastify, test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

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
    for (const tier of ["standard", "premium"]) {
      await prisma.tierRate.create({ data: { tier, inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    }
    await createResolvableModel(prisma, { slug: STANDARD_MODEL, tier: "standard" });
    await createResolvableModel(prisma, { slug: PREMIUM_MODEL, tier: "premium" });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  /** A signed-in user with paid credits (the portal's paid path), and the given package tiers when any. */
  const fundedUser = async (packageTiers?: string[]) => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    if (packageTiers) await createPackageSnapshot(prisma, { userId: user.id, allowedTiers: packageTiers });
    return user;
  };

  const chat = (user: { id: string; email: string }, model: string) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": SESSION, ...asSessionUser(user) },
      payload: { model, messages: [{ role: "user", content: "Hi" }] },
    });

  it.each([
    ["a package without the tier", ["standard"]],
    ["a free account (no package)", undefined],
  ])("%s asks for a premium model: 400 feature=tier, nothing reserved, no ledger row, no provider call", async (_name, packageTiers) => {
    const inputUser = await fundedUser(packageTiers);
    const expectedLedgerRows = await prisma.creditLedgerEntry.count();
    const mockAssertAvailable = jest.spyOn(CreditService.prototype, "assertAvailable");

    const actual = await chat(inputUser, PREMIUM_MODEL);

    expect(actual.statusCode).toBe(400);
    expect(actual.json().error).toEqual({ type: "PACKAGE_LIMIT_REACHED", feature: "tier", requested: ["premium"], nextPackage: null });
    expect(mockAssertAvailable).not.toHaveBeenCalled();
    expect(await prisma.creditReservation.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count()).toBe(expectedLedgerRows);
    expect(fake.requests).toHaveLength(0);
  });

  it("a free account (no package) on the cheapest tier: allowed without reading the packages", async () => {
    const inputUser = await fundedUser();
    const mockGetForUser = jest.spyOn(EntitlementService.prototype, "getForUser");
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await chat(inputUser, STANDARD_MODEL);

    expect(actual.statusCode).toBe(200);
    expect(actual.body).toContain("data: [DONE]");
    expect(mockGetForUser).not.toHaveBeenCalled();
    expect(await prisma.creditReservation.findMany({ select: { status: true } })).toEqual([{ status: "settled" }]);
  });

  it("a package with the premium tier asks for a premium model: allowed (control)", async () => {
    const inputUser = await fundedUser(["standard", "premium"]);
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const actual = await chat(inputUser, PREMIUM_MODEL);

    expect(actual.statusCode).toBe(200);
    expect(actual.body).toContain("data: [DONE]");
    expect(fake.requests).toHaveLength(1);
  });
});
