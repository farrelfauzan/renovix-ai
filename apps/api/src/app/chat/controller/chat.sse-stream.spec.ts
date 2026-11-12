import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { PromptTuningService } from "../service/prompt-tuning.service";
import { ConversationService } from "../service/conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProviderRouter } from "../../providers/provider-router";
import { HealthController } from "../../health/controller/health.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { SseStream } from "../../../common/utils/sse-stream";
import { buildCorsOptions } from "../../../common/utils/build-cors-options";
import { createFastifyAdapter } from "../../../common/utils/create-fastify-adapter";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createApiKey, createUser, testApiKey } from "../../../../test/factories";
import { requestSse } from "../../../../test/sse-socket";

// RNX-42: the streamed POST /chat/completions (API key) is opened by the SSE helper, and its CORS headers are the
// app's (main.ts's CORS options, CORS_ORIGIN set to one origin, D324): the API-key route has no origin check, so a
// foreign origin reaches the stream and is the negative case. Real ChatController and ChatService; the API key is on
// the test database; credits, registry, tuning, router, usage and conversation are stubs (ESM-only ones mocked).
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

const API_KEY = testApiKey("rnx42-test-key");
const ALLOWED_ORIGIN = "https://chat.rnx42.test";
const FOREIGN_ORIGIN = "https://evil.rnx42.test";
const MODEL = "stream-model";
const RATE = new Decimal(1);

describe("RNX-42: the API-key chat stream on the SSE helper (Fastify, test database)", () => {
  const savedCorsOrigin = process.env.CORS_ORIGIN;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ChatController, HealthController],
      providers: [
        ChatService,
        {
          provide: CreditService,
          useValue: {
            assertAvailable: async () => undefined,
            reserve: async () => ({ id: "reservation-1" }),
            finishCall: async () => ({ amount: new Decimal(-1), tokensNew: 3, tokensCached: 0, tokensOut: 2 }),
          },
        },
        {
          provide: ModelRegistryService,
          useValue: {
            resolveConnection: async (slug: string) => ({ slug, providerName: "stub", baseUrl: "http://127.0.0.1:1/v1", apiKey: "rnx42-not-real" }),
            getModel: async (slug: string) => ({ slug, tier: "standard" }),
            getTierRates: async () => ({ inputCreditsPerToken: RATE, cachedCreditsPerToken: RATE, outputCreditsPerToken: RATE }),
          },
        },
        {
          provide: ProviderRouter,
          useValue: {
            resolveMaxTokens: () => 1000,
            chatStream: async function* () {
              yield JSON.stringify({ choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] });
            },
          },
        },
        {
          provide: PromptTuningService,
          useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
        },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { cors: buildCorsOptions(process.env) });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createApiKey(prisma, (await createUser(prisma)).id, { apiKey: API_KEY });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    if (savedCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = savedCorsOrigin;
  });

  const stream = (origin?: string) =>
    requestSse(app, {
      method: "POST",
      path: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}`, ...(origin && { origin }) },
      body: { model: MODEL, messages: [{ role: "user", content: "Hi" }], stream: true },
    });

  /** The CORS headers a JSON route of the app (GET /health) gets for `origin`. */
  const appCorsHeadersFor = async (origin: string) => {
    const health = await requestSse(app, { method: "GET", path: "/health", headers: { origin } });
    return [health.headers["access-control-allow-origin"], health.headers["access-control-allow-credentials"], health.headers.vary];
  };

  it("AC1: the helper opens the stream: 200 with text/event-stream, no-cache and keep-alive; chunks then [DONE]", async () => {
    const open = jest.spyOn(SseStream.prototype, "open");

    const actual = await stream();

    expect(open).toHaveBeenCalledTimes(1);
    expect([actual.statusCode, actual.headers["content-type"], actual.headers["cache-control"], actual.headers.connection]).toEqual([
      200,
      "text/event-stream",
      "no-cache",
      "keep-alive",
    ]);
    expect(actual.body).toContain('"object":"chat.completion.chunk"');
    expect(actual.body.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("AC6 negative: an origin not in the list gets no Access-Control-Allow-Origin on the stream (nor on a JSON route)", async () => {
    const actual = await stream(FOREIGN_ORIGIN);

    expect(actual.statusCode).toBe(200);
    expect(actual.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await appCorsHeadersFor(FOREIGN_ORIGIN))[0]).toBeUndefined();
  });

  it("AC6 control: the listed origin gets the CORS headers the app sets on its other routes", async () => {
    const actual = await stream(ALLOWED_ORIGIN);

    const actualCors = [actual.headers["access-control-allow-origin"], actual.headers["access-control-allow-credentials"], actual.headers.vary];
    expect(actualCors).toEqual([ALLOWED_ORIGIN, "true", "Origin"]);
    expect(actualCors).toEqual(await appCorsHeadersFor(ALLOWED_ORIGIN));
  });
});
