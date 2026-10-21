import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { AgentController } from "./agent.controller";
import { AgentService } from "../service/agent.service";
import { WorkspaceService } from "../../workspace/service/workspace.service";
import { WorkspaceQuotaService } from "../../workspace/service/workspace-quota.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { blockOutbound, OutboundBlocker, pointLlmAtStubs, sendJson, startStubHttpServer, StubHttpServer } from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";
import { captureOutput } from "../../../../test/capture-output";
import { plantedProviderSecret } from "../../../../test/planted-provider-secret";

// RNX-190 (D197, D208): a non-stream chat call on a route that does not catch its error (POST /agents/generate-prompt,
// ProviderRouter.chat), answered 401 with a body that echoes the key's last characters and its SHA-256 (RX-174).
// Nest's ExceptionsHandler logs the error; neither planted value may reach a printed line (Nest's Logger is not
// mocked) or the response. Real controller, AgentService, ProviderRouter and OpenRouterAdapter against a local stub.

const RECORD_KEY = "rnx190-marker-key-not-real-record";

describe("RNX-190: provider error body on the agent prompt-generation route (Fastify, test database)", () => {
  let provider: StubHttpServer;
  let envStub: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    [provider, envStub] = await Promise.all([startStubHttpServer(), startStubHttpServer()]);
    restoreEnv = pointLlmAtStubs({ primary: envStub, apiKey: "rnx190-marker-key-not-real-env" });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [AgentController],
      providers: [AgentService, WorkspaceService, WorkspaceQuotaService, ModelRegistryService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    provider.requests.length = 0;
    envStub.requests.length = 0;
    await resetDatabase(prisma);
    await createResolvableModel(prisma, { slug: "fake/usable-standard", provider: { baseUrl: provider.baseUrl, apiKey: RECORD_KEY } });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => {
    blocker.restore();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([provider?.close(), envStub?.close()]);
    restoreEnv?.();
  });

  it("AC1: the provider answers 401 with a planted key suffix and SHA-256 → neither is in any output line or in the response", async () => {
    provider.respond((_r, res) => sendJson(res, 401, plantedProviderSecret.body));
    const user = await createUser(prisma);
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);
    const output = captureOutput();

    const res = await app.inject({
      method: "POST",
      url: "/agents/generate-prompt",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Helper" },
    });

    expect({
      status: res.statusCode,
      providerCalls: provider.requests.length,
      leakingOutputLines: output.lines.filter(plantedProviderSecret.isFoundIn),
      leaksInResponse: plantedProviderSecret.isFoundIn(res.body),
    }).toEqual({ status: 500, providerCalls: 1, leakingOutputLines: [], leaksInResponse: false });
    // The route does print the failure: the control that this capture sees Nest's ExceptionsHandler line.
    expect(output.lines.some((line) => line.includes("ExceptionsHandler"))).toBe(true);
  });
});
