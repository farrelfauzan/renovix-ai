import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChatController } from "./chat.controller";
import { ChatService } from "../service/chat.service";
import { PromptTuningService } from "../service/prompt-tuning.service";
import { ConversationService } from "../service/conversation.service";
import { CreditService } from "../../billing/service/credit.service";
import { UsageService } from "../../usage/service/usage.service";
import { DocumentService } from "../../document/service/document.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { AppLogger } from "../../../common/logger/app-logger";
import { createFastifyAdapter } from "../../../common/utils/create-fastify-adapter";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import {
  blockOutbound,
  OutboundBlocker,
  pointLlmAtStubs,
  sendJson,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";

// RNX-17 AC1: one chat request on the API-key route whose provider answers 400 (the error path of RX-169: HTTP 500,
// nothing charged). Every line the real logger writes meanwhile (Nest's Logger not mocked, stdout and stderr
// captured) is one JSON object carrying that request's id, the route pattern and the caller's account id. The id is
// read from Fastify (an onRequest hook of this test), and the lines are found by it.
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));
jest.mock("../service/prompt-tuning.service", () => ({ PromptTuningService: class {} }));
jest.mock("../service/conversation.service", () => ({ ConversationService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));

const PRIMARY_KEY = "rnx17-marker-key-not-real-primary";
const API_KEY = testApiKey("rnx17-test-key");

/** Every line written to stdout or stderr while `act` runs (the writes are swallowed). */
async function captureOutput(act: () => Promise<unknown>): Promise<string[]> {
  const chunks: string[] = [];
  const write = (chunk: string | Uint8Array): boolean => chunks.push(String(chunk)) > 0;
  const out = jest.spyOn(process.stdout, "write").mockImplementation(write);
  const err = jest.spyOn(process.stderr, "write").mockImplementation(write);
  try {
    await act();
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return chunks.join("").split("\n").filter(Boolean);
}

/** The line as JSON, or `{ notJson: line }` so a line that is not JSON shows in the failure. */
function parseLine(line: string): Record<string, unknown> {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { notJson: line };
  }
}

describe("RNX-17 AC1: the log lines of one chat request carry its id, route and account (Fastify, test database)", () => {
  let primary: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const requestIds: string[] = [];

  beforeAll(async () => {
    primary = await startStubHttpServer();
    restoreEnv = pointLlmAtStubs({ primary, apiKey: PRIMARY_KEY });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [ChatController],
      providers: [
        ChatService,
        CreditService,
        ModelRegistryService,
        {
          provide: PromptTuningService,
          useValue: {
            applyTuning: async (messages: unknown) => ({ tunedMessages: messages, matchedTemplate: null }),
          },
        },
        { provide: UsageService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.useLogger(new AppLogger({ json: true, logLevels: ["log", "error", "warn", "debug", "verbose", "fatal"] }));
    app.getHttpAdapter().getInstance().addHook("onRequest", (request, _reply, done) => {
      requestIds.push(request.id);
      done();
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    await resetDatabase(prisma);
    await createResolvableModel(prisma, {
      slug: "test-model",
      modelName: "test-model",
      inputPrice: 0.000001,
      outputPrice: 0.000001,
      maxTokens: 8192,
      provider: { baseUrl: primary.baseUrl, apiKey: PRIMARY_KEY },
    });
    await prisma.tierRate.create({
      data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await primary?.close();
    restoreEnv?.();
  });

  it("the provider answers 400 → HTTP 500; every line of that request has its id, the route and the account id", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
    const user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    await fundPaidWallet(prisma, user.id, 1);
    requestIds.length = 0;
    let status = 0;

    const lines = await captureOutput(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/chat/completions",
        headers: { authorization: `Bearer ${API_KEY}` },
        payload: { model: "test-model", messages: [{ role: "user", content: "Hi" }] },
      });
      status = res.statusCode;
    });

    const entries = lines.map(parseLine);
    const [requestId] = requestIds;
    expect(status).toBe(500);
    expect(requestIds).toHaveLength(1);
    expect(entries.map(({ level, requestId: id, route, accountId }) => ({ level, id, route, accountId }))).toEqual(
      entries.map(({ level }) => ({ level, id: requestId, route: "/chat/completions", accountId: user.id })),
    );
    expect(entries.filter((entry) => entry.requestId === requestId)).toEqual(entries);
    expect(entries.some((entry) => entry.level === "error")).toBe(true);
  });
});
