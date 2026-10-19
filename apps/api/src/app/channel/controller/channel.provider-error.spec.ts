import { request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
import { DocumentService } from "../../document/service/document.service";
import { AgentToolService } from "../../agent/service/agent-tool.service";
import { AgentMemoryService } from "../../agent/service/agent-memory.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { ProvidersModule } from "../../providers/providers.module";
import { HealthController } from "../../health/controller/health.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createUser } from "../../../../test/factories";
import {
  blockOutbound,
  OutboundBlocker,
  pointLlmAtStubs,
  sendJson,
  startStubHttpServer,
  StubHttpServer,
} from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";

// RX-169: POST /channels/:id/agents/:agentId/chat answers the client over SSE,
// but calls the provider without streaming (ProviderRouter.chat). A provider
// 400 must still reach the client as an SSE error event, with the process
// running: Jest fails the test on any uncaught exception or unhandled
// rejection. Real ChannelController, ChannelChatService and OpenRouterAdapter
// against a local stub; these collaborators load ESM-only packages. The app
// listens on a real port: the route sets a timeout on the request's socket,
// which app.inject's mock socket does not have.
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const PRIMARY_KEY = "rx169-marker-key-not-real-primary";

interface HttpAnswer {
  status: number;
  contentType: string | undefined;
  body: string;
}

/** One request to the listening app over a real socket; resolves when the response has ended. */
const send = (params: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) =>
  new Promise<HttpAnswer>((resolve, reject) => {
    const payload = params.body === undefined ? undefined : JSON.stringify(params.body);
    const req = httpRequest(
      params.url,
      {
        method: params.method,
        headers: { ...params.headers, ...(payload && { "content-type": "application/json" }) },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, contentType: res.headers["content-type"], body }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });

describe("RX-169: provider error on the channel chat route (Fastify, test database)", () => {
  let primary: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let appUrl: string;

  beforeAll(async () => {
    primary = await startStubHttpServer();
    restoreEnv = pointLlmAtStubs({ primary, apiKey: PRIMARY_KEY });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [ChannelController, HealthController],
      providers: [
        ChannelService,
        ChannelChatService,
        ModelRegistryService,
        {
          provide: AgentToolService,
          useValue: {
            buildToolSchemasWithMcp: async () => [],
            clearLastDocumentResult: () => undefined,
            getLastDocumentResult: () => null,
          },
        },
        { provide: AgentMemoryService, useValue: { getWorkspaceMemoryContext: async () => "" } },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: S3Service, useValue: {} },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    await app.listen(0, "127.0.0.1");
    appUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    primary.requests.length = 0;
    await resetDatabase(prisma);
    await createResolvableModel(prisma, {
      slug: "test-model",
      modelName: "test-model",
      inputPrice: 0.000001,
      outputPrice: 0.000001,
      maxTokens: 8192,
      provider: { baseUrl: primary.baseUrl, apiKey: PRIMARY_KEY },
    });
    await moduleRef.get(ModelRegistryService).refresh();
  });

  afterEach(() => blocker.restore());

  afterAll(async () => {
    await app?.close();
    await primary?.close();
    restoreEnv?.();
  });

  it("AC6: provider answers 400 → SSE error event naming 400, response ends, health answers", async () => {
    primary.respond((_r, res) => sendJson(res, 400, { error: { message: "unknown model" } }));
    const user = await createUser(prisma);
    const agent = await createAgent(prisma, { userId: user.id });
    const channel = await prisma.channel.create({ data: { userId: user.id, name: "Room" } });
    await prisma.channelAgent.create({ data: { channelId: channel.id, agentId: agent.id } });
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);

    const res = await send({
      method: "POST",
      url: `${appUrl}/channels/${channel.id}/agents/${agent.id}/chat`,
      headers: { authorization: `Bearer ${token}` },
      body: { message: "Hi" },
    });

    const errorEvents = res.body
      .split("\n\n")
      .filter((event) => event.startsWith('data: {"error"'))
      .map((event) => JSON.parse(event.slice("data: ".length)).error.message);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/event-stream");
    expect(errorEvents).toEqual([expect.stringMatching(/400/)]);
    // the document-intent classifier and the chat itself, neither streamed
    expect(primary.requests.map((r) => r.body.stream)).toEqual([undefined, undefined]);
    const health = await send({ method: "GET", url: `${appUrl}/health` });
    expect(health.status).toBe(200);
  });
});
