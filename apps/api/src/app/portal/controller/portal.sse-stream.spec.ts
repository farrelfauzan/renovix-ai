import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PortalController } from "./portal.controller";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PortalTierService } from "../service/portal-tier.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { ProviderRouter } from "../../providers/provider-router";
import type { ChatMessage } from "../../providers/provider.interface";
import { CreditService } from "../../billing/service/credit.service";
import { countCharTokens } from "../../billing/utils/count-char-tokens";
import { promptText } from "../../billing/utils/prompt-text";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import { SseStream } from "../../../common/utils/sse-stream";
import { buildCorsOptions } from "../../../common/utils/build-cors-options";
import { createFastifyAdapter } from "../../../common/utils/create-fastify-adapter";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { FakeProviderAdapter, withFakeProvider } from "../../../../test/fake-provider";
import { createResolvableModel } from "../../../../test/provider-model";
import { asSessionUser } from "../../../../test/as-session-user";
import { disconnectAfter, requestSse } from "../../../../test/sse-socket";

// RNX-42: POST /chat/portal/completions opens every one of its streams (free and paid, the plain answer and the input
// guardrail block) with the SSE helper, and its abort-on-disconnect is the helper's signal. Real PortalController,
// CreditService, model registry and provider router (fake adapter; chatStream is replaced per test) on the test
// database; the tier service, tuning, guardrail, knowledge, usage and conversation are stubs. The app is started with
// main.ts's CORS options and CORS_ORIGIN set to one origin (D324), set before the module is built.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const ALLOWED_ORIGIN = "https://chat.rnx42.test";
const FOREIGN_ORIGIN = "https://evil.rnx42.test";
const MODEL = "standard-cheap";
const FREE_SESSION = "11111111-1111-4111-8111-111111111111";
const BLOCKED_REPLY = "RNX42-INPUT-BLOCKED";
const MESSAGES = [{ role: "user", content: "Hi" }];
const notBlocked = async () => ({ blocked: false });

describe("RNX-42: the portal completions on the SSE helper (Fastify, test database)", () => {
  const savedCorsOrigin = process.env.CORS_ORIGIN;
  const fake = new FakeProviderAdapter();
  const mockCheckInput = jest.fn(notBlocked);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
    ({ moduleRef, prisma } = await createTestModule(
      {
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
        controllers: [PortalController],
        providers: [
          EntitlementService,
          CreditService,
          ModelRegistryService,
          { provide: PortalTierService, useValue: { getOrCreateSession: async () => ({}), reserveFreeRequest: async () => "ok" } },
          {
            provide: PromptTuningService,
            useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
          },
          { provide: GuardrailService, useValue: { checkInput: mockCheckInput } },
          { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
          { provide: UsageService, useValue: { logUsage: async () => undefined } },
          {
            provide: ConversationService,
            useValue: {
              getOrCreateConversation: async () => "conversation-id",
              saveMessages: async () => undefined,
              generateTitle: async () => undefined,
            },
          },
          { provide: DocumentService, useValue: {} },
        ],
      },
      (b) => withFakeProvider(b, fake),
    ));
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { cors: buildCorsOptions(process.env) });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mockCheckInput.mockReset().mockImplementation(notBlocked);
    await createResolvableModel(prisma, { slug: MODEL, modelName: MODEL, inputPrice: 0.000001, outputPrice: 0.000001, maxTokens: 8192 });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    if (savedCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = savedCorsOrigin;
  });

  /** The provider stream answers one content chunk, "Hello". */
  const answerHello = () =>
    jest.spyOn(moduleRef.get(ProviderRouter), "chatStream").mockImplementation(async function* () {
      yield JSON.stringify({ choices: [{ delta: { content: "Hello" } }] });
    });

  /** The headers and body of a free request (no user) or a paid one (a user funded with 5 credits), from `origin`. */
  const requestOf = async (tier: "free" | "paid", origin = ALLOWED_ORIGIN) => {
    if (tier === "free") return { headers: { "x-portal-session": FREE_SESSION, origin }, body: { messages: MESSAGES } };
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    return { headers: { "x-portal-session": FREE_SESSION, ...asSessionUser(user), origin }, body: { model: MODEL, messages: MESSAGES } };
  };

  const complete = async (tier: "free" | "paid", origin = ALLOWED_ORIGIN) =>
    requestSse(app, { method: "POST", path: "/chat/portal/completions", ...(await requestOf(tier, origin)) });

  describe("AC1: every portal stream is opened by the helper with the three headers", () => {
    it.each([
      ["free", "free" as const, false],
      ["free, input guardrail block", "free" as const, true],
      ["paid", "paid" as const, false],
      ["paid, input guardrail block", "paid" as const, true],
    ])("%s", async (_name, tier, isBlocked) => {
      answerHello();
      if (isBlocked) mockCheckInput.mockImplementation(async () => ({ blocked: true, userMessage: BLOCKED_REPLY }) as never);
      const open = jest.spyOn(SseStream.prototype, "open");

      const actual = await complete(tier);

      expect(open).toHaveBeenCalledTimes(1);
      expect([actual.statusCode, actual.headers["content-type"], actual.headers["cache-control"], actual.headers.connection]).toEqual([
        200,
        "text/event-stream",
        "no-cache",
        "keep-alive",
      ]);
      expect(actual.body).toContain(isBlocked ? BLOCKED_REPLY : '"content":"Hello"');
      expect(actual.body.endsWith("data: [DONE]\n\n")).toBe(true);
    });
  });

  describe("AC6: CORS on the portal stream comes from the allow-list, not the request", () => {
    it.each(["free" as const, "paid" as const])("control (%s): the listed origin gets itself with credentials", async (tier) => {
      answerHello();

      const actual = await complete(tier);

      expect([actual.headers["access-control-allow-origin"], actual.headers["access-control-allow-credentials"], actual.headers.vary]).toEqual([
        ALLOWED_ORIGIN,
        "true",
        "Origin",
      ]);
    });

    it.each(["free" as const, "paid" as const])("negative (%s): an origin not in the list is not echoed (refused before the stream)", async (tier) => {
      const chatStream = answerHello();

      const actual = await complete(tier, FOREIGN_ORIGIN);

      expect(actual.statusCode).toBe(403);
      expect(actual.headers["access-control-allow-origin"]).toBeUndefined();
      expect(chatStream).not.toHaveBeenCalled();
    });
  });

  it("AC3: a paid client that disconnects after the first chunk → upstream aborted, one client_cancel entry charged ceil(chars / 4) (D205), held 0", async () => {
    const upstream: { signal?: AbortSignal; messages: ChatMessage[] } = { messages: [] };
    jest.spyOn(moduleRef.get(ProviderRouter), "chatStream").mockImplementation(async function* (params) {
      upstream.signal = params.signal;
      upstream.messages = params.messages;
      yield JSON.stringify({ choices: [{ delta: { content: "Hello" } }] });
      await new Promise<void>((resolve) => params.signal?.addEventListener("abort", () => resolve(), { once: true }));
    });

    await disconnectAfter(app, { method: "POST", path: "/chat/portal/completions", ...(await requestOf("paid")), waitFor: "Hello" });
    for (let i = 0; i < 100 && (await prisma.creditReservation.count({ where: { status: "open" } })) > 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(upstream.signal?.aborted).toBe(true);
    const tokensNew = countCharTokens(promptText(upstream.messages));
    const tokensOut = countCharTokens("Hello");
    const entries = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
    const reservations = await prisma.creditReservation.findMany();
    const [account] = await prisma.creditAccount.findMany();
    expect({
      entries: entries.map((e) => [e.outcome, e.tokensNew, e.tokensCached, e.tokensOut, e.amount.toFixed(6)]),
      reservations: reservations.map((r) => r.status),
      held: account.held.toFixed(6),
    }).toEqual({
      entries: [["client_cancel", tokensNew, 0, tokensOut, (-(tokensNew + tokensOut) / 1_000_000).toFixed(6)]],
      reservations: ["settled"],
      held: "0.000000",
    });
    await assertCreditLedgerInvariants(prisma);
  }, 10000);
});
