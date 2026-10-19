import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatService } from "./chat.service";
import { ConversationService } from "./conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { CreditsExhaustedException } from "../../billing/errors/credits-exhausted.exception";
import { ModelRegistryService } from "../../config/model-registry.service";
import { DocumentService } from "../../document/service/document.service";
import { EmbeddingService } from "../../knowledge/service/embedding.service";
import { UsageService } from "../../usage/service/usage.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { realPromptTuning } from "../../../../test/real-prompt-tuning";

// RX-22 review B1: prompt tuning embeds the query for the system and user knowledge searches (paid /embeddings
// calls), so a user who cannot pay is refused with 402 BEFORE tuning. The REAL PromptTuningService and knowledge
// services run; only EmbeddingService.embedSingle is spied (and answers locally, so no request leaves).
jest.mock("./conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

describe("RX-22 review B1: the API-key chat refuses an unaffordable request before prompt tuning (test database)", () => {
  const fake = new FakeProviderAdapter();
  const tuning = realPromptTuning();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let embedSingle: jest.SpyInstance;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        providers: [
          ChatService,
          CreditService,
          ModelRegistryService,
          ...tuning.providers,
          { provide: ConversationService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await prisma.aiModel.create({
      data: { slug: "b1-model", modelName: "b1-model", providerId: "vendor/b1-model", inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192 },
    });
    // An active system knowledge base: tuning would embed the query for it as well as for the user's bases.
    await prisma.knowledgeBase.create({ data: { name: "system", isSystem: true, active: true } });
    await moduleRef.get(ModelRegistryService).refresh();
    embedSingle = jest
      .spyOn(moduleRef.get(EmbeddingService), "embedSingle")
      .mockResolvedValue({ embedding: Array.from({ length: 1024 }, () => 0), tokenCount: 1 });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await moduleRef?.close();
    tuning.restoreEnv();
  });

  const complete = (userId: string) =>
    moduleRef.get(ChatService).createCompletion(
      { model: "b1-model", messages: [{ role: "user", content: "Hi" }], store: false },
      { id: userId, email: "u@test.local", balance: new Decimal(0) },
    );

  it("a user with 0 ledger credits: 402, no embedding call, no provider call, nothing written", async () => {
    const user = await createUser(prisma);

    await expect(complete(user.id)).rejects.toBeInstanceOf(CreditsExhaustedException);

    expect(embedSingle).not.toHaveBeenCalled();
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.creditReservation.count()).toBe(0);
  });

  it("control: a funded user is tuned (both knowledge searches embed the query) and charged", async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 1);
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });

    await complete(user.id);

    expect(embedSingle).toHaveBeenCalledTimes(2);
    expect(await prisma.creditReservation.findMany({ select: { status: true } })).toEqual([{ status: "settled" }]);
  });
});
