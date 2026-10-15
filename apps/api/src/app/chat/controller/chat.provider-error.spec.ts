import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Decimal } from "@prisma/client/runtime/client";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { PromptTuningService } from "../service/prompt-tuning.service";
import { ConversationService } from "../service/conversation.service";
import { BillingService } from "../../billing/service/billing.service";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { HealthController } from "../../health/controller/health.controller";
import { PrismaService } from "../../prisma/prisma.service";
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

// RX-169: the API-key route POST /chat/completions never streams (its request
// schema has no `stream` field; ChatService calls ProviderRouter.chat). A
// provider 400 must reach the client in this route's format (HTTP 500 JSON,
// balance refunded) with the process running: Jest fails the test on any
// uncaught exception or unhandled rejection. Real ChatController, ChatService
// and OpenRouterAdapter against a local stub; these collaborators load
// ESM-only packages.
jest.mock("../../billing/service/billing.service", () => ({ BillingService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const PRIMARY_KEY = "rx169-marker-key-not-real-primary";
const API_KEY = "sk_live_rx169-test-key";

describe("RX-169: provider error on the API-key chat route (Fastify, test database)", () => {
  let primary: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const billing = {
    reserveCredits: jest.fn(async () => new Decimal(1)),
    refundReservation: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    primary = await startStubHttpServer();
    restoreEnv = pointLlmAtStubs({ primary, apiKey: PRIMARY_KEY });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [ChatController, HealthController],
      providers: [
        ChatService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: BillingService, useValue: billing },
        { provide: UsageService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    primary.requests.length = 0;
    await resetDatabase(prisma);
    await prisma.aiModel.create({
      data: {
        slug: "test-model",
        modelName: "test-model",
        providerId: "vendor/test-model",
        inputPrice: 0.000001,
        outputPrice: 0.000001,
        maxTokens: 8192,
      },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => blocker.restore());

  afterAll(async () => {
    await app?.close();
    await primary?.close();
    restoreEnv?.();
  });

  it("AC7: provider answers 400 → HTTP 500 JSON with the refund message, balance refunded, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
    await createUser(prisma, { apiKey: API_KEY });

    const res = await app.inject({
      method: "POST",
      url: "/chat/completions",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }] },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      statusCode: 500,
      message: "Failed to get response from model provider. Your balance has been refunded.",
    });
    expect(billing.refundReservation).toHaveBeenCalledTimes(1);
    expect(primary.requests).toHaveLength(1);
    expect(primary.requests[0].body.stream).toBeUndefined();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });
});
