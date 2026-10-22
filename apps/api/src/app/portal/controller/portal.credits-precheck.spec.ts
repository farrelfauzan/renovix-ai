import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { PortalTierService } from "../service/portal-tier.service";
import { CreditService } from "../../billing/service/credit.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { DocumentService } from "../../document/service/document.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { SystemKnowledgeService } from "../../knowledge/service/system-knowledge.service";
import { UsageService } from "../../usage/service/usage.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { realPromptTuning } from "../../../../test/real-prompt-tuning";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RX-22 review B1: the paid portal path refuses with 402 BEFORE prompt tuning, whose knowledge searches embed the
// query (paid /embeddings calls). The REAL PromptTuningService and knowledge services run; only
// EmbeddingService.embedSingle is spied (it answers locally) and the system KB's startup sync is skipped.
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rx22-test-secret";

describe("RX-22 review B1: the paid portal chat refuses an unaffordable request before prompt tuning (Fastify, test database)", () => {
  const fake = new FakeProviderAdapter();
  const tuning = realPromptTuning();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let embedSingle: jest.SpyInstance;

  beforeAll(async () => {
    jest.spyOn(SystemKnowledgeService.prototype, "onApplicationBootstrap").mockResolvedValue(undefined);
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [PortalController],
        providers: [
          PortalTierService,
          CreditService,
          ModelRegistryService,
          ...tuning.providers,
          { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
          {
            provide: ConversationService,
            useValue: { getOrCreateConversation: async () => "conversation-id", saveMessages: async () => undefined, generateTitle: async () => undefined },
          },
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
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await createResolvableModel(prisma, {
      slug: "b1-model", modelName: "b1-model", inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192,
    });
    await prisma.knowledgeBase.create({ data: { name: "system", isSystem: true, active: true } });
    await moduleRef.get(ModelRegistryService).refresh();
    embedSingle = jest
      .spyOn(moduleRef.get(EmbeddingService), "embedSingle")
      .mockResolvedValue({ embedding: Array.from({ length: 1024 }, () => 0), tokenCount: 1 });
  });

  afterEach(() => embedSingle.mockRestore());

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
    tuning.restoreEnv();
  });

  const paidChat = (user: { id: string; email: string }) =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: {
        "x-portal-session": "77777777-7777-4777-8777-777777777777",
        ...asSessionUser(user),
      },
      payload: { model: "b1-model", messages: [{ role: "user", content: "Hi" }] },
    });

  it("a signed-in user whose paid wallet cannot cover the estimate: 402, no embedding call, no provider call, nothing written", async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, "0.000001"); // paid tier (available > 0), far below the estimate

    const res = await paidChat(user);

    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ code: "CREDITS_EXHAUSTED" });
    expect(embedSingle).not.toHaveBeenCalled();
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
  });

  it("control: a funded user is tuned (both knowledge searches embed the query) and charged", async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 1);
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const res = await paidChat(user);

    expect(res.body).toContain("data: [DONE]");
    expect(embedSingle).toHaveBeenCalledTimes(2);
    expect(await prisma.creditReservation.findMany({ select: { status: true } })).toEqual([{ status: "settled" }]);
  });
});
