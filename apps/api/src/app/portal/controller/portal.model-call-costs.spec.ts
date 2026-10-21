import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
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
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";

// RNX-162 AC8: a paid portal stream (POST /chat/portal/completions, the portal's only completion route; it has no
// JSON answer) writes one model_call_costs row for its call, right after its usage entry. Fake provider, test database.
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx162-test-secret";

const SESSION = "16216216-2162-4162-8162-162162162162";
const SLUG = "rnx162-portal-model";

describe("RNX-162: model call costs on the paid portal stream (Fastify, test database)", () => {
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
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await prisma.exchangeRate.create({
      data: { base: "USD", quote: "IDR", rate: "16000", rateDate: new Date(new Date().toISOString().slice(0, 10)), fetchedAt: new Date(), source: "frankfurter" },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("AC8 portal path: one row for the call, priced from the model's prices, rupiah at the stored rate", async () => {
    const { provider } = await createResolvableModel(prisma, { slug: SLUG, inputPrice: "0.000001", outputPrice: "0.000002" });
    await moduleRef.get(ModelRegistryService).refresh();
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 1000, completion_tokens: 200 } });

    const res = await app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: {
        "x-portal-session": SESSION,
        authorization: `Bearer ${moduleRef.get(JwtService).sign({ userId: user.id, email: user.email })}`,
      },
      payload: { model: SLUG, messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(200);
    const [entry] = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
    const rows = await prisma.modelCallCost.findMany();
    expect(rows.map((r) => [r.callId, r.providerId, r.providerModelId, r.wallet, r.tokenPriceUsd?.toFixed(12), r.costLowIdr?.toFixed(6)])).toEqual([
      [entry.callId, provider.id, SLUG, "paid", "0.001400000000", "22.400000"],
    ]);
  });
});
