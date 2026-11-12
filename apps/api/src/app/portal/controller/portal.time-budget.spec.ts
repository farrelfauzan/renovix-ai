import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { PortalTierService } from "../service/portal-tier.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderRouter } from "../../providers/provider-router";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { blockOutbound, OutboundBlocker, sendSse, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";

// RNX-44 AC9 (portal): POST /chat/portal/completions, free and paid, reads the platform setting modelCallBudgetSeconds
// (the real PlatformSettingsService on the test database) once per request and passes it as the stream's
// `timeBudgetMs`; a changed setting applies to the next call. The real portal route (Fastify) and the real
// OpenRouterAdapter talk to a local stub upstream; blockOutbound keeps every other host off the network.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
process.env.IP_HASH_SECRET = "rnx44-test-secret";

const SLUG = "rnx44-cheap";
const SETTING = "modelCallBudgetSeconds";
const AUTHOR = { changedBy: "rnx-44-test", reason: "RNX-44 test" };
const MS_PER_SECOND = 1000;

describe("RNX-44 AC9: the portal route passes the model call time budget (Fastify, test database)", () => {
  let upstream: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    upstream = await startStubHttpServer();
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [PortalController],
      providers: [
        EntitlementService,
        PortalTierService,
        CreditService,
        ModelRegistryService,
        PlatformSettingsService,
        { provide: PromptTuningService, useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) } },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        {
          provide: ConversationService,
          useValue: { getOrCreateConversation: async () => "conversation-id", saveMessages: async () => undefined, generateTitle: async () => undefined },
        },
        { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    upstream.requests.length = 0;
    upstream.respond((_r, res) => sendSse(res, ['{"choices":[{"delta":{"content":"ok"}}]}']));
    await resetDatabase(prisma);
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await createResolvableModel(prisma, {
      slug: SLUG, modelName: SLUG, inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192,
      provider: { baseUrl: upstream.baseUrl, apiKey: "rnx44-not-real" },
    });
    await moduleRef.get(ModelRegistryService).refresh();
    // The free tier's own settings (the decided values, as createTestModule's stand-in gives them).
    await prisma.platformSetting.createMany({ data: [{ name: "anonymousRequestsPerSession", value: 20 }, { name: "anonymousSessionsPerIp", value: 3 }] });
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await upstream?.close();
  });

  const setBudget = (seconds: number) => moduleRef.get(PlatformSettingsService).saveSetting({ name: SETTING, value: seconds, author: AUTHOR });

  const freeChat = () =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "44444444-4444-4444-8444-444444444441" },
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

  const paidChat = async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    return app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "44444444-4444-4444-8444-444444444442", ...asSessionUser(user) },
      payload: { model: SLUG, messages: [{ role: "user", content: "Hi" }] },
    });
  };

  it.each([
    ["free", freeChat],
    ["paid", paidChat],
  ])("%s: the stream carries the setting's budget, and the changed value on the next call", async (_tier, call) => {
    const chatStream = jest.spyOn(moduleRef.get(ProviderRouter), "chatStream");
    await setBudget(30);
    await call();
    await setBudget(45);

    const res = await call();

    expect(res.body).toContain("data: [DONE]");
    expect(chatStream.mock.calls.map(([params]) => params.timeBudgetMs)).toEqual([30 * MS_PER_SECOND, 45 * MS_PER_SECOND]);
  });

  it("paid, a 1 s budget and no first token: the stream ends with an error event within it; one provider_error entry of 0, the hold released", async () => {
    await setBudget(1);
    upstream.respond(() => undefined);
    const startedAt = Date.now();

    const res = await paidChat();

    expect(Date.now() - startedAt).toBeLessThan(2 * MS_PER_SECOND);
    expect(res.body).toContain('"error"');
    expect(res.body).not.toContain("data: [DONE]");
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
    expect(entries.map((e) => [e.outcome, e.amount.toFixed(6)])).toEqual([["provider_error", "0.000000"]]);
    expect((await prisma.creditReservation.findMany()).map((r) => r.status)).toEqual(["released"]);
    await assertCreditLedgerInvariants(prisma);
  });
});
