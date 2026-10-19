import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { PromptTuningService } from "../service/prompt-tuning.service";
import { ConversationService } from "../service/conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { estimateCallCredits } from "../../billing/utils/estimate-call-credits";
import { countPromptTokens } from "../../billing/utils/count-prompt-tokens";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { MODEL_UNAVAILABLE_MESSAGE } from "../../config/errors/model-unavailable.exception";
import { AdminProvidersService } from "../../admin-providers/service/admin-providers.service";
import { AdminProviderModelsService } from "../../admin-providers/service/admin-provider-models.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { createResolvableModel } from "../../../../test/provider-model";
import {
  blockOutbound,
  chatCompletion,
  OutboundBlocker,
  pointLlmAtStubs,
  sendJson,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";

// RX-178 (D199): POST /chat/completions resolves the request's slug to its model's provider record and sends the
// call to that record's base URL with its key, the slug as sent. Three local stubs: the provider record's, the env
// endpoint (LLM_BASE_URL / LLM_API_KEY) and the removed env fallback (LLM_FALLBACK_*); every other host is blocked.
// Real ChatController, ChatService, ModelRegistryService, AdminProvidersService and OpenRouterAdapter; these
// collaborators load ESM-only packages.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const RECORD_KEY = "rx178-marker-key-not-real-record";
const ROTATED_KEY = "rx178-marker-key-not-real-rotated";
const ENV_KEY = "rx178-marker-key-not-real-env";
const FALLBACK_KEY = "rx178-marker-key-not-real-fallback";
const API_KEY = "sk_live_rx178-test-key";
const SLUG = "fake/route-model";

describe("RX-178: chat calls resolved from the slug to the provider record (Fastify, test database)", () => {
  let providerStub: StubHttpServer;
  let envStub: StubHttpServer;
  let fallbackStub: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let registry: ModelRegistryService;

  beforeAll(async () => {
    [providerStub, envStub, fallbackStub] = await Promise.all([
      startStubHttpServer(),
      startStubHttpServer(),
      startStubHttpServer(),
    ]);
    restoreEnv = pointLlmAtStubs({ primary: envStub, apiKey: ENV_KEY, fallback: fallbackStub, fallbackApiKey: FALLBACK_KEY });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [ChatController],
      providers: [
        ChatService,
        CreditService,
        ModelRegistryService,
        AdminProvidersService,
        AdminProviderModelsService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    registry = moduleRef.get(ModelRegistryService);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    for (const stub of [providerStub, envStub, fallbackStub]) {
      stub.requests.length = 0;
      stub.respond((_r, res) => sendJson(res, 200, chatCompletion("from this stub")));
    }
    await resetDatabase(prisma);
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([providerStub?.close(), envStub?.close(), fallbackStub?.close()]);
    restoreEnv?.();
  });

  /** A model on an active provider record whose base URL is providerStub; the registry reloaded. */
  const resolvable = async (over: Parameters<typeof createResolvableModel>[1] = {}) => {
    const created = await createResolvableModel(prisma, {
      slug: SLUG,
      ...over,
      provider: { baseUrl: providerStub.baseUrl, apiKey: RECORD_KEY, ...over.provider },
    });
    await registry.refresh();
    return created;
  };

  const fundedUser = async () => {
    const user = await createUser(prisma, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 5);
    return user;
  };

  const chat = (payload: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: SLUG, messages: [{ role: "user", content: "Hi" }], ...payload },
    });

  const inTransaction = <T>(write: (tx: Parameters<Parameters<TransactionService["run"]>[0]>[0]) => Promise<T>) =>
    moduleRef.get(TransactionService).run(write);

  it("AC1: a model on an active provider → the call goes to that provider's base URL with its key and the slug as sent; env endpoints get nothing", async () => {
    await resolvable();
    await fundedUser();

    const res = await chat();

    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("from this stub");
    expect(providerStub.requests).toHaveLength(1);
    expect(providerStub.requests[0].url).toBe("/v1/chat/completions");
    expect(providerStub.requests[0].headers.authorization).toBe(`Bearer ${RECORD_KEY}`);
    expect(providerStub.requests[0].body.model).toBe(SLUG);
    expect(envStub.requests).toHaveLength(0);
    expect(fallbackStub.requests).toHaveLength(0);
    expect(blocker.blocked).toHaveLength(0);
  });

  describe("AC2: an unresolvable model → 400 with the fixed text, no upstream request, no credit written", () => {
    const cases: [string, () => Promise<void>][] = [
      ["an unknown slug", async () => registry.refresh()],
      [
        "a model without a provider record",
        async () => {
          await prisma.aiModel.create({
            data: { slug: SLUG, modelName: SLUG, inputPrice: "0.000001", outputPrice: "0.000001", maxTokens: 8192 },
          });
          await registry.refresh();
        },
      ],
      ["an inactive provider", async () => void (await resolvable({ provider: { status: "inactive" } }))],
      [
        "a soft-deleted provider (status still active: the nested read is filtered on deletedAt itself)",
        async () => void (await resolvable({ provider: { status: "active", deletedAt: new Date() } })),
      ],
    ];

    it.each(cases)("%s", async (_name, arrange) => {
      await arrange();
      const user = await fundedUser();
      const entriesBefore = await prisma.creditLedgerEntry.count();

      const res = await chat();

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe(MODEL_UNAVAILABLE_MESSAGE);
      expect(res.body).not.toContain(SLUG);
      expect(res.body).not.toContain("rx178-marker-key");
      expect([providerStub, envStub, fallbackStub].map((stub) => stub.requests.length)).toEqual([0, 0, 0]);
      expect(blocker.blocked).toHaveLength(0);
      expect(await prisma.creditReservation.count()).toBe(0);
      expect(await prisma.creditLedgerEntry.count()).toBe(entriesBefore);
      const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: user.id, wallet: "paid" } } });
      expect([account.balance.toFixed(6), account.held.toFixed(6)]).toEqual(["5.000000", "0.000000"]);
      await assertCreditLedgerInvariants(prisma);
    });
  });

  describe("AC3 (D199-2): the handling process drops a provider from its cache at once, without waiting for the 60 s refresh", () => {
    it.each([
      ["deactivated", { status: "inactive" as const }],
      ["given a new key", { apiKey: ROTATED_KEY }],
    ])("a provider %s: the next call in the same process is refused, no reload, no upstream request", async (_name, change) => {
      const { admin, provider } = await resolvable();
      await fundedUser();
      expect((await chat()).statusCode).toBe(200);
      const reload = jest.spyOn(registry, "refresh");

      await inTransaction((tx) => moduleRef.get(AdminProvidersService).update(admin.id, provider.id, change, tx));
      const res = await chat();

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe(MODEL_UNAVAILABLE_MESSAGE);
      expect(reload).not.toHaveBeenCalled();
      expect(providerStub.requests).toHaveLength(1);
    });

    it("a model deactivated through the admin API: the next call in the same process is refused, no reload, no upstream request", async () => {
      const { provider, model } = await resolvable();
      await fundedUser();
      expect((await chat()).statusCode).toBe(200);
      const reload = jest.spyOn(registry, "refresh");

      await inTransaction((tx) => moduleRef.get(AdminProviderModelsService).update(provider.id, model.id, { active: false }, tx));
      const res = await chat();

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe(MODEL_UNAVAILABLE_MESSAGE);
      expect(reload).not.toHaveBeenCalled();
      expect(providerStub.requests).toHaveLength(1);
    });

    it("a soft-deleted provider: the next call is refused at once", async () => {
      const { admin, provider, model } = await resolvable();
      await fundedUser();
      expect((await chat()).statusCode).toBe(200);
      await prisma.aiModel.update({ where: { id: model.id }, data: { active: false } });
      const reload = jest.spyOn(registry, "refresh");

      await inTransaction((tx) => moduleRef.get(AdminProvidersService).remove(admin.id, provider.id, tx));
      const res = await chat();

      expect(res.statusCode).toBe(400);
      expect(reload).not.toHaveBeenCalled();
      expect(providerStub.requests).toHaveLength(1);
    });

    it("D195: key change → inactive → test → activate → the next call uses the new key", async () => {
      const { admin, provider } = await resolvable();
      await fundedUser();
      const providers = moduleRef.get(AdminProvidersService);

      await inTransaction((tx) => providers.update(admin.id, provider.id, { apiKey: ROTATED_KEY }, tx));
      const refused = await chat();
      const outcome = await providers.test(admin.id, provider.id, SLUG, "rx178-request");
      await inTransaction((tx) => providers.activate(admin.id, provider.id, tx));
      const res = await chat();

      expect(refused.statusCode).toBe(400);
      expect(outcome.isSuccessful).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(providerStub.requests.map((r) => r.headers.authorization)).toEqual([`Bearer ${ROTATED_KEY}`, `Bearer ${ROTATED_KEY}`]);
    });
  });

  // Retry-After: 0 keeps the test fast: one retry of the same provider at once (RX-161), where the removed fallback
  // used to take the call straight away.
  it.each([502, 503])("AC4 (D199-4): the provider answers %i → the error surfaces; the env fallback receives 0", async (status) => {
    await resolvable();
    await fundedUser();
    providerStub.respond((_r, res) => {
      res.writeHead(status, { "Content-Type": "application/json", "Retry-After": "0" });
      res.end(JSON.stringify({ error: { message: "provider down" } }));
    });

    const res = await chat();

    expect(res.statusCode).toBe(500);
    expect(providerStub.requests).toHaveLength(2);
    expect(fallbackStub.requests).toHaveLength(0);
    expect(envStub.requests).toHaveLength(0);
  });

  it("AC5: a dashed slug of a reasoning model gets the max_tokens floor, and the hold uses the same M", async () => {
    const dashed = "x/claude-opus-5-5";
    await resolvable({ slug: dashed });
    await fundedUser();
    const messages = [{ role: "user", content: "Hi" }];
    const rates = { rateNew: new Decimal(1), rateCached: new Decimal(1), rateOut: new Decimal(1) };

    const res = await chat({ model: dashed, messages, max_tokens: 100 });

    expect(res.statusCode).toBe(200);
    expect(providerStub.requests[0].body).toMatchObject({ model: dashed, max_tokens: 2000 });
    const [reservation] = await prisma.creditReservation.findMany();
    expect(reservation.amountHeld.toFixed(6)).toBe(estimateCallCredits(countPromptTokens(messages), 2000, rates).toFixed(6));
    expect(reservation.amountHeld.toFixed(6)).not.toBe(estimateCallCredits(countPromptTokens(messages), 100, rates).toFixed(6));
  });
});
