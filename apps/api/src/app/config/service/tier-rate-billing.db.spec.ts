import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ChatService } from "../../chat/service/chat.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { DocumentService } from "../../document/service/document.service";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { ProvidersModule } from "../../providers/providers.module";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";

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
          CreditService,
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
      // docs/credits.md section 1.4 Advanced: new 5, cached 6, output 4 (prisma/tier-rates.seed.json)
      data: { tier: "advanced", inputCreditsPerToken: 5, cachedCreditsPerToken: 6, outputCreditsPerToken: 4 },
    });
    await createResolvableModel(prisma, {
      slug: "ac1-model",
      modelName: "ac1-model",
      inputPrice: 0.000001,
      outputPrice: 0.000002,
      maxTokens: 8192,
      tier: "advanced",
    });
    await registry.refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  const complete = (userId: string) =>
    chat.createCompletion(
      { model: "ac1-model", messages: [{ role: "user", content: "Hi" }], store: false },
      { id: userId, email: "u@test.local" },
    );

  /** RX-22: the newest usage entry of the user on the credit ledger (was: the newest success Transaction row). */
  const successLedgerOf = async (userId: string) => {
    const ledger = await prisma.creditLedgerEntry.findMany({
      where: { memberUserId: userId, type: "usage" },
      orderBy: { seq: "asc" },
    });
    return ledger[ledger.length - 1];
  };

  /** A user funded with 100 credits through the ledger (RX-22: was User.balance 100). */
  const fundedUser = async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 100);
    return user;
  };

  it("charges the seeded advanced rate, then the changed rate, with no deploy", async () => {
    const user = await fundedUser();
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, completion_tokens: 50 } });

    await complete(user.id);

    // (100 x 5 + 50 x 4) / 1,000,000 = 0.0007 credits (section 1.3 formula)
    expect((await successLedgerOf(user.id)).amount.toFixed(6)).toBe("-0.000700");

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
    await assertCreditLedgerInvariants(prisma);
  });

  // RX-22: was a placeholder (the adapter did not report cached tokens; the case charged them as new input). Now the
  // provider's prompt_tokens_details.cached_tokens reach the usage entry and are priced at the cached rate.
  it("prices reported cached input at the tier's cached rate (Advanced 5/6/4: cached is not priced as new)", async () => {
    const user = await fundedUser();
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 100, cached_tokens: 60, completion_tokens: 50 } });

    await complete(user.id);

    const entry = await successLedgerOf(user.id);
    expect([entry.tokensNew, entry.tokensCached, entry.tokensOut]).toEqual([40, 60, 50]);
    expect([entry.rateNew?.toFixed(0), entry.rateCached?.toFixed(0), entry.rateOut?.toFixed(0)]).toEqual(["5", "6", "4"]);
    // (40 x 5 + 60 x 6 + 50 x 4) / 1,000,000 = 0.00076 credits; at the new rate it would be 0.0007
    expect(entry.amount.toFixed(6)).toBe("-0.000760");
    await assertCreditLedgerInvariants(prisma);
  });

  // RX-22: the reservation is E = I x max(new, cached) + M x out (docs/credits.md section 3.1 rule 1), with I the
  // prompt actually sent (after tuning, knowledge context included) and M the max_tokens the adapter resolves.
  it("reserves the estimate of the tuned prompt and the resolved max_tokens, then settles to the actual charge", async () => {
    const user = await fundedUser();
    const tuned = [
      { role: "system" as const, content: "x".repeat(4_000) },
      { role: "user" as const, content: "Hi" },
    ];
    jest
      .spyOn(moduleRef.get(PromptTuningService), "applyTuning")
      .mockResolvedValueOnce({ tunedMessages: tuned, matchedTemplate: null } as never);
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 1_000, completion_tokens: 50 } });

    await complete(user.id);

    // I = (6 + 4,000 + 4) + (4 + 2 + 4) = 4,020; M = 4,096 (no caller value); E = 4,020 x 6 + 4,096 x 4 = 40,504
    const [reservation] = await prisma.creditReservation.findMany();
    expect([reservation.amountHeld.toFixed(6), reservation.status, reservation.consumed.toFixed(6)]).toEqual([
      "0.040504", "settled", "0.005200",
    ]);
    expect(fake.requests[0].messages).toEqual(tuned);
  });
});
