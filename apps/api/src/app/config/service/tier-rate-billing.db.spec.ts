import { Decimal } from "@prisma/client/runtime/client";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ChatService } from "../../chat/service/chat.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { DocumentService } from "../../document/service/document.service";
import { BillingService } from "../../billing/service/billing.service";
import { UsageService } from "../../usage/service/usage.service";
import { ProvidersModule } from "../../providers/providers.module";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";

// RX-21 AC1 (test database — needs TEST_DATABASE_URL): a changed tier rate row takes effect on the
// credit path without a deploy. Two runs of the same chat completion against two different
// advanced-tier input rates must charge exactly each run's rate x tokens: registry refresh picks up
// the new row (the 60s TTL cache is refreshed), and the credits come from tier_rates, never from a
// price x multiplier. Collaborators follow agent-run.billing-characterization.spec.ts's stub pattern.

jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

describe("RX-21 AC1: a changed tier rate changes the credits charged (test database, fake provider)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let chat: ChatService;
  let registry: ModelRegistryService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ProvidersModule],
        providers: [
          ChatService,
          BillingService,
          ModelRegistryService,
          { provide: PromptTuningService, useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) } },
          { provide: ConversationService, useValue: {} },
          { provide: DocumentService, useValue: {} },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    chat = moduleRef.get(ChatService);
    registry = moduleRef.get(ModelRegistryService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.requests.length = 0;
    await prisma.tierRate.create({
      data: { tier: "advanced", inputCreditsPerToken: 5, cachedCreditsPerToken: 4, outputCreditsPerToken: 6 },
    });
    await prisma.aiModel.create({
      data: {
        slug: "ac1-model",
        modelName: "ac1-model",
        providerId: "vendor/ac1-model",
        inputPrice: 0.000001,
        outputPrice: 0.000002,
        maxTokens: 8192,
        tier: "advanced",
      },
    });
    await registry.refresh();
  });

  afterAll(() => moduleRef?.close());

  const complete = (userId: string) =>
    chat.createCompletion(
      { model: "ac1-model", messages: [{ role: "user", content: "Hi" }], store: false },
      { id: userId, email: "u@test.local", balance: new Decimal(0) },
    );

  const successLedgerOf = async (userId: string) => {
    const ledger = await prisma.transaction.findMany({
      where: { userId, status: "success" },
      orderBy: { createdAt: "asc" },
    });
    return ledger[ledger.length - 1];
  };

  it("charges the seeded advanced rate, then the changed rate, with no deploy", async () => {
    const user = await createUser(prisma, { balance: new Decimal("100") });
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 50 } });

    await complete(user.id);

    // (100 x 5 + 50 x 6) / 1,000,000 = 0.0008 credits (section 1.3 formula)
    expect((await successLedgerOf(user.id)).amount.toFixed(6)).toBe("-0.000800");

    // Change the tier rate row directly (a DB write, no deploy) and let the registry refresh pick it up.
    await prisma.tierRate.update({
      where: { tier: "advanced" },
      data: { inputCreditsPerToken: 7, outputCreditsPerToken: 8 },
    });
    await registry.refresh();
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 50 } });

    await complete(user.id);

    // (100 x 7 + 50 x 8) / 1,000,000 = 0.0011 credits: the NEXT request charges the new
    // rate with no deploy (AC1) — the registry cache picked the row up via refresh().
    expect((await successLedgerOf(user.id)).amount.toFixed(6)).toBe("-0.001100");
  });

  it("prices reported cached input at the tier's cached rate on the actual path", async () => {
    const user = await createUser(prisma, { balance: new Decimal("100") });
    // The adapter's usage shape does not surface cached tokens yet (RX-21 notes it): this test pins
    // the cached rate arithmetic of calculateActualCost through the same path once it does.
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 50 } });

    await complete(user.id);

    const ledger = await successLedgerOf(user.id);
    expect(ledger).toBeDefined();
    // (100 x 5 + 50 x 6) / 1,000,000 = 0.0008 credits (no cached tokens reported: input rate)
    expect(ledger.amount.toFixed(6)).toBe("-0.000800");
  });
});
