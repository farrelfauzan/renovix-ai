import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { PortalTierService } from "../service/portal-tier.service";
import { CodesController } from "../../codes/controller/codes.controller";
import { CodesService } from "../../codes/service/codes.service";
import { CreditService } from "../../billing/service/credit.service";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
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
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-186: GET /chat/portal/usage is the chat app's one balance read (header and top-up page): the ledger's paid
// wallet, never User.balance (gone). The second case is the top-up page's flow: a code redemption grants on the
// ledger, a paid portal chat spends from it, and the usage endpoint answers the account row's available credits.
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
process.env.IP_HASH_SECRET = "rnx186-test-secret";

const SESSION = "18618618-6186-4186-8186-186186186186";

describe("RNX-186: the chat balance read is the ledger account (Fastify, test database)", () => {
  const fake = new FakeProviderAdapter();
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [PortalController, CodesController],
        providers: [
          PortalTierService,
          CodesService,
          CreditService,
          CreditLedgerService,
          ModelRegistryService,
          {
            provide: PromptTuningService,
            useValue: {
              applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
            },
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
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await createResolvableModel(prisma, {
      slug: "rnx186-model", modelName: "rnx186-model", inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192,
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterAll(async () => {
    await app?.close();
  });

  const headersOf = (user: { id: string; email: string }) => ({
    "x-portal-session": SESSION,
    ...asSessionUser(user),
  });

  /** The user's paid account row: available credits (balance - held), as the API formats them. */
  const accountAvailable = async (userId: string) => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });
    return account.balance.minus(account.held).toFixed(6);
  };

  it("a funded user: GET /chat/portal/usage answers the paid tier with the account row's balance", async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);

    const res = await app.inject({ method: "GET", url: "/chat/portal/usage", headers: headersOf(user) });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tier: "paid", balance: await accountAvailable(user.id), unlimited: true });
    expect(res.json().balance).toBe("5.000000");
  });

  it("a code redemption grants on the ledger, a paid portal chat spends from it, and the usage read follows the account row", async () => {
    const user = await createUser(prisma);
    await prisma.invitationCode.create({ data: { code: "PERF-RNX1-0186", type: "topup", creditAmount: 5 } });

    const redeemed = await app.inject({
      method: "POST", url: "/codes/redeem", headers: headersOf(user), payload: { code: "PERF-RNX1-0186" },
    });
    const afterRedeem = await app.inject({ method: "GET", url: "/chat/portal/usage", headers: headersOf(user) });
    fake.enqueue({ content: "Hello", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const chat = await app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: headersOf(user),
      payload: { model: "rnx186-model", messages: [{ role: "user", content: "Hi" }] },
    });
    const afterChat = await app.inject({ method: "GET", url: "/chat/portal/usage", headers: headersOf(user) });

    expect([redeemed.statusCode, chat.statusCode]).toEqual([201, 200]);
    expect(redeemed.json()).toMatchObject({ success: true, creditsGranted: 5 });
    expect(afterRedeem.json()).toMatchObject({ tier: "paid", balance: "5.000000" });
    const entries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: user.id }, orderBy: { seq: "asc" } });
    expect(entries.map((e) => [e.type, e.amount.toFixed(6), e.balanceAfter.toFixed(6)])).toEqual([
      ["bonus", "5.000000", "5.000000"],
      ["usage", "-0.000015", "4.999985"],
    ]);
    expect(afterChat.json()).toEqual({ tier: "paid", balance: await accountAvailable(user.id), unlimited: true });
    expect(afterChat.json().balance).toBe("4.999985");
    await assertCreditLedgerInvariants(prisma);
  });
});
