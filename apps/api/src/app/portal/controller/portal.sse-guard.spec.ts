import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Decimal } from "@prisma/client/runtime/client";
import { PortalController } from "./portal.controller";
import { PortalTierService } from "../service/portal-tier.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProviderRouter } from "../../providers/provider-router";
import { HealthController } from "../../health/controller/health.controller";
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
import { captureLogs, requestOverSocket, sseErrorMessages } from "../../../../test/sse-client";

// RNX-171 AC3/AC4: POST /chat/portal/completions (free and paid paths) is wrapped by the SSE stream guard. A
// collaborator throws a plain Error after the SSE headers, and the route's own catch then throws too (its first
// "Stream error" log line throws): the client still gets an error event and the end of the stream, GET /health
// answers, and no key, token, cookie or session value is logged. Jest fails the running test on any uncaught
// exception or unhandled rejection, so a green test also means none was raised. The controller's collaborators are
// fakes; the portal guard is real (a funded user on the test database makes the paid path).
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const MARKER_KEY = "rnx171-marker-key-not-real-portal";
const MARKER_SESSION = "rnx171-marker-session-not-real-portal";
const MARKER_COOKIE = "rnx171-marker-cookie-not-real-portal";

const MODEL = { slug: "standard-cheap", tier: "standard", maxOutputTokens: 1000 };
const CONNECTION = { slug: MODEL.slug, providerName: "stub", baseUrl: "http://127.0.0.1:1/v1", apiKey: MARKER_KEY };
const RATE = new Decimal(1);

describe("RNX-171: the portal stream guard (Fastify, real socket)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [PortalController, HealthController],
      providers: [
        { provide: PortalTierService, useValue: { getOrCreateSession: async () => ({}), reserveFreeRequest: async () => "ok" } },
        {
          provide: ModelRegistryService,
          useValue: {
            getCheapestModel: async () => MODEL,
            getModel: async () => MODEL,
            resolveConnection: async () => CONNECTION,
            getTierRates: async () => ({ inputCreditsPerToken: RATE, cachedCreditsPerToken: RATE, outputCreditsPerToken: RATE }),
          },
        },
        {
          provide: CreditService,
          useValue: { assertAvailable: async () => undefined, reserve: async () => ({ id: "reservation" }), finishCall: async () => ({}) },
        },
        { provide: ProviderRouter, useValue: { chatStream: () => [], resolveMaxTokens: () => MODEL.maxOutputTokens } },
        {
          provide: PromptTuningService,
          useValue: { applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }) },
        },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
        { provide: UsageService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  const chat = (headers: Record<string, string>, model?: string) =>
    requestOverSocket(app, {
      method: "POST",
      path: "/chat/portal/completions",
      headers: { "x-portal-session": MARKER_SESSION, cookie: `better-auth.session_token=${MARKER_COOKIE}`, ...headers },
      body: { ...(model && { model }), messages: [{ role: "user", content: "Hi" }] },
    });

  const plantThrowInRouteCatch = () =>
    captureLogs({ when: /^Stream error/, error: new Error(`the route's catch failed, cookie=${MARKER_COOKIE}`) });

  const expectGuardedEnd = async (
    res: Awaited<ReturnType<typeof chat>>,
    logs: ReturnType<typeof captureLogs>,
    secrets: string[],
  ) => {
    expect(logs.wasPlantedThrown()).toBe(true);
    expect([res.statusCode, res.contentType, res.ended]).toEqual([200, "text/event-stream", true]);
    expect(sseErrorMessages(res.body)).toEqual(["The response failed. Please try again."]);
    expect(logs.lines).toContain("SSE stream ended by an error after its headers were sent (Error)");
    expect(logs.lines.filter((l) => secrets.some((s) => l.includes(s)) || l.includes("ERR_HTTP_HEADERS_SENT"))).toEqual([]);
    const health = await requestOverSocket(app, { method: "GET", path: "/health" });
    expect([health.statusCode, JSON.parse(health.body)]).toEqual([200, { status: "ok", database: "connected" }]);
  };

  it("free path: prompt tuning throws after the headers, then the route's catch throws → error event, stream ends, health answers, no secret logged", async () => {
    const logs = plantThrowInRouteCatch();
    jest.spyOn(moduleRef.get(PromptTuningService), "applyTuning").mockImplementation(async () => {
      throw new Error("planted collaborator failure");
    });

    const res = await chat({});

    await expectGuardedEnd(res, logs, [MARKER_KEY, MARKER_SESSION, MARKER_COOKIE]);
  }, 15000);

  it("paid path: the provider call throws after the headers, then the route's catch throws → error event, stream ends, health answers, no secret logged", async () => {
    const user = await createUser(prisma);
    await fundPaidWallet(prisma, user.id, 5);
    const token = moduleRef.get(JwtService).sign({ userId: user.id, email: user.email });
    const logs = plantThrowInRouteCatch();
    const reserve = jest.spyOn(moduleRef.get(CreditService), "reserve");
    const chatStream = jest.spyOn(moduleRef.get(ProviderRouter), "chatStream").mockImplementation(() => {
      throw new Error("planted collaborator failure");
    });

    const res = await chat({ authorization: `Bearer ${token}` }, MODEL.slug);

    expect([reserve.mock.calls.length, chatStream.mock.calls.length]).toEqual([1, 1]); // the paid path
    await expectGuardedEnd(res, logs, [MARKER_KEY, MARKER_SESSION, MARKER_COOKIE, token]);
  }, 15000);
});
