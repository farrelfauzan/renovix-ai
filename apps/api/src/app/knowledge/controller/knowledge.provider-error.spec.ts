import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "../service/knowledge.service";
import { EmbeddingService } from "../service/embedding.service";
import { S3Service } from "../service/s3.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";
import { blockOutbound, OutboundBlocker, sendJson, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";
import { captureOutput } from "../../../../test/capture-output";
import { plantedProviderSecret } from "../../../../test/planted-provider-secret";

// RNX-190 (D197, D208): an embedding call on a route (POST /v1/knowledge/search) answered 401 with a body that echoes
// the key's last characters and its SHA-256 (RX-174). The route does not catch the error, so Nest's ExceptionsHandler
// logs it; neither planted value may reach a printed line (Nest's Logger is not mocked) or the response. Real
// controller, KnowledgeService and EmbeddingService against a local stub; S3 is not used by this route.
jest.mock("../service/s3.service", () => ({ S3Service: class {} }));

const EMBEDDING_ENV_KEYS = ["LLM_PROVIDER", "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL"] as const;
const savedEnv = EMBEDDING_ENV_KEYS.map((k) => process.env[k]);
const API_KEY = testApiKey("rnx190-test-key");

describe("RNX-190: provider error body on the knowledge search route (Fastify, test database)", () => {
  let stub: StubHttpServer;
  let blocker: OutboundBlocker;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    stub = await startStubHttpServer();
    EMBEDDING_ENV_KEYS.forEach((k) => delete process.env[k]);
    process.env.EMBEDDING_BASE_URL = stub.baseUrl;
    process.env.EMBEDDING_API_KEY = "rnx190-marker-key-not-real-embedding";
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [KnowledgeController],
      providers: [KnowledgeService, EmbeddingService, { provide: S3Service, useValue: {} }],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    stub.requests.length = 0;
    await resetDatabase(prisma);
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await stub?.close();
    EMBEDDING_ENV_KEYS.forEach((k, i) => {
      if (savedEnv[i] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[i];
    });
  });

  it("AC1: the embedding provider answers 401 with a planted key suffix and SHA-256 → neither is in any output line or in the response", async () => {
    stub.respond((_r, res) => sendJson(res, 401, plantedProviderSecret.body));
    await createApiKey(prisma, (await createUser(prisma)).id, { apiKey: API_KEY });
    const output = captureOutput();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/search",
      headers: { authorization: `Bearer ${API_KEY}` },
      payload: { query: "hello" },
    });

    expect({
      status: res.statusCode,
      embeddingCalls: stub.requests.length,
      leakingOutputLines: output.lines.filter(plantedProviderSecret.isFoundIn),
      leaksInResponse: plantedProviderSecret.isFoundIn(res.body),
    }).toEqual({ status: 500, embeddingCalls: 1, leakingOutputLines: [], leaksInResponse: false });
    // The search does print the failure: the control that this capture sees Nest's ExceptionsHandler line.
    expect(output.lines.some((line) => line.includes("ExceptionsHandler"))).toBe(true);
  });
});
