import { Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Decimal } from "@prisma/client/runtime/client";
import axios from "axios";
import { PortalController } from "./portal.controller";
import { PortalTierService } from "../service/portal-tier.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { OpenRouterAdapter } from "../../providers/openrouter.adapter";
import { HealthController } from "../../health/controller/health.controller";
import { BillingService } from "../../billing/service/billing.service";
import { UsageService } from "../../usage/service/usage.service";
import { PromptTuningService } from "../../chat/service/prompt-tuning.service";
import { ConversationService } from "../../chat/service/conversation.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { DocumentService } from "../../document/service/document.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import {
  blockOutbound,
  OutboundBlocker,
  pointLlmAtStubs,
  sendJson,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";

// RX-169: a provider that answers a streamed portal chat with an error status
// must give the client an SSE error event and leave the process running. The
// real OpenRouterAdapter talks to local stub servers (blockOutbound keeps every
// other host off the network). Jest fails the running test on any uncaught
// exception or unhandled rejection, so a green test also means none was raised.
jest.mock("../../billing/service/billing.service", () => ({ BillingService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../../chat/service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../../chat/service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const PRIMARY_KEY = "rx169-marker-key-not-real-primary";
const FALLBACK_KEY = "rx169-marker-key-not-real-fallback";
process.env.IP_HASH_SECRET = "rx169-test-secret";

describe("RX-169: provider error on a streamed portal chat (Fastify, test database)", () => {
  let primary: StubHttpServer;
  let fallback: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let restoreEnv: () => void;
  const billing = {
    reserveCredits: jest.fn(async () => new Decimal(1)),
    refundReservation: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    [primary, fallback] = await Promise.all([startStubHttpServer(), startStubHttpServer()]);
    restoreEnv = pointLlmAtStubs({ primary, apiKey: PRIMARY_KEY, fallback, fallbackApiKey: FALLBACK_KEY });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [PortalController, HealthController],
      providers: [
        PortalTierService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: BillingService, useValue: billing },
        { provide: UsageService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: KnowledgeService, useValue: { listKnowledgeBases: async () => [] } },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    primary.requests.length = 0;
    fallback.requests.length = 0;
    billing.refundReservation.mockClear();
    await resetDatabase(prisma);
    await prisma.aiModel.create({
      data: {
        slug: "standard-cheap",
        modelName: "standard-cheap",
        providerId: "vendor/standard-cheap",
        inputPrice: 0.000001,
        outputPrice: 0.000001,
        maxTokens: 8192,
      },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([primary?.close(), fallback?.close()]);
    restoreEnv?.();
  });

  const freeChat = () =>
    app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "11111111-1111-4111-8111-111111111111" },
      payload: { messages: [{ role: "user", content: "Hi" }] },
    });

  const paidChat = async () => {
    const user = await createUser(prisma, { balance: 5 });
    const token = moduleRef.get(JwtService).sign({ userId: user.id, email: user.email });
    return app.inject({
      method: "POST",
      url: "/chat/portal/completions",
      headers: { "x-portal-session": "22222222-2222-4222-8222-222222222222", authorization: `Bearer ${token}` },
      payload: { model: "standard-cheap", messages: [{ role: "user", content: "Hi" }] },
    });
  };

  /** The `error.message` of the SSE error event in a response body (undefined when there is none). */
  const sseErrorMessage = (body: string): string | undefined =>
    body
      .split("\n\n")
      .map((event) => event.replace(/^data: /, ""))
      .filter((data) => data.startsWith('{"error"'))
      .map((data) => JSON.parse(data).error.message as string)[0];

  const expectHealthy = async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", database: "connected" });
  };

  it("AC1: free tier, provider answers 400 → SSE error event naming 400, response ends, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));

    const res = await freeChat();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(sseErrorMessage(res.body)).toMatch(/400/);
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(0);
    await expectHealthy();
  });

  it("AC2: primary and fallback both answer 503 → SSE error event naming 503, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 503, { error: { message: "primary down" } }));
    fallback.respond((_r, res) => sendJson(res, 503, { error: { message: "fallback down" } }));

    const res = await freeChat();

    expect(sseErrorMessage(res.body)).toMatch(/503/);
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(1);
    await expectHealthy();
  });

  it("AC3: the provider's error text (trimmed to 300 characters) reaches the client; no key in any log line", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) =>
      void lines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    for (const m of ["log", "warn", "error", "debug", "verbose", "fatal"] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(capture);
    }
    for (const m of ["log", "warn", "error", "info", "debug"] as const) jest.spyOn(console, m).mockImplementation(capture);
    const providerText = `RX169-PROVIDER-TEXT context length exceeded ${"y".repeat(400)}`;
    primary.respond((_r, res) => {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end(providerText);
    });

    const res = await freeChat();

    const message = sseErrorMessage(res.body);
    expect(message).toContain(providerText.slice(0, 300));
    expect(message).not.toContain(providerText.slice(0, 301));
    expect(primary.requests[0].headers.authorization).toBe(`Bearer ${PRIMARY_KEY}`);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("RX169-PROVIDER-TEXT"))).toBe(true);
    expect(lines.filter((l) => l.includes("rx169-marker-key"))).toEqual([]);
    expect(res.body).not.toContain("rx169-marker-key");
    await expectHealthy();
  });

  it("AC5: paid tier, provider answers 400 → SSE error event naming 400 with the refund note, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));

    const res = await paidChat();

    expect(res.statusCode).toBe(200);
    expect(sseErrorMessage(res.body)).toMatch(/400.*Balance refunded\.$/);
    expect(billing.refundReservation).toHaveBeenCalledTimes(1);
    await expectHealthy();
  });

  describe("AC4: the error the adapter rethrows can be read by extractProviderError", () => {
    const extract = (error: unknown) =>
      moduleRef.get(PortalController)["extractProviderError"](error);

    it("the error exactly as the adapter rethrew it before RX-169 (AxiosError, response.data a drained stream) does not throw", async () => {
      primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
      const thrown = await axios
        .post(`${primary.baseUrl}/chat/completions`, {}, { responseType: "stream" })
        .catch((err) => err);
      for await (const _chunk of thrown.response.data) {
        // drained, as OpenRouterAdapter.openStream did before rethrowing
      }

      const actual = extract(thrown);

      expect(axios.isAxiosError(thrown)).toBe(true);
      expect(actual.status).toBe(400);
      expect(actual.clientMessage).toMatch(/400/);
    });

    it("the adapter's stream error carries the status and the body text, and extractProviderError uses them", async () => {
      primary.respond((_r, res) => sendJson(res, 429, { error: { message: "RX169 slow down" } }));
      const adapter = moduleRef.get(OpenRouterAdapter);
      const thrown = await (async () => {
        for await (const _payload of adapter.chatStream({ model: "m", providerId: "vendor/m", messages: [] })) {
          // no payload is expected
        }
      })().catch((err) => err);

      const actual = extract(thrown);

      expect(thrown).toMatchObject({ status: 429, bodyText: '{"error":{"message":"RX169 slow down"}}' });
      expect(actual).toMatchObject({ status: 429 });
      expect(actual.clientMessage).toBe('Provider request failed (429): {"error":{"message":"RX169 slow down"}}');
    });
  });
});
