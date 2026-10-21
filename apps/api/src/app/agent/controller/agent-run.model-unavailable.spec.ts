import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { AddressInfo } from "node:net";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { AgentRunController } from "./agent-run.controller";
import { AgentRunService } from "../service/agent-run.service";
import { AgentRunMeterService } from "../service/agent-run-meter.service";
import { CreditService } from "../../billing/service/credit.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { AgentToolService } from "../service/agent-tool.service";
import { AgentMemoryService } from "../service/agent-memory.service";
import { KnowledgeService } from "../../knowledge/service/knowledge.service";
import { WorkspaceKnowledgeService } from "../../workspace/service/workspace-knowledge.service";
import { DocumentService } from "../../document/service/document.service";
import { UsageService } from "../../usage/service/usage.service";
import { GuardrailService } from "../../guardrail/service/guardrail.service";
import { ModelRegistryService } from "../../config/model-registry.service";
import { MODEL_UNAVAILABLE_MESSAGE } from "../../config/errors/model-unavailable.exception";
import { ProvidersModule } from "../../providers/providers.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createAgent, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { blockOutbound, OutboundBlocker, pointLlmAtStubs, sendJson, startStubHttpServer, StubHttpServer, chatCompletion } from "../../../../test/llm-stub";
import { createResolvableModel } from "../../../../test/provider-model";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { captureLogs, sseErrorMessages } from "../../../../test/sse-client";

// RX-178 review B1: POST /agents/:id/chat answers 400 with the fixed text for an agent whose model cannot be resolved
// (an old slug with no model row, or a model on an inactive provider), BEFORE the document-intent classifier call, the
// SSE headers, the quota, the run and the user message. Real AgentRunController, AgentRunService, ModelRegistryService
// and OpenRouterAdapter against a local stub; the app listens on a real port (the route sets a socket timeout).
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

const RECORD_KEY = "rx178-marker-key-not-real-agent-route";
const OLD_SLUG = "vendor/old-slug-without-a-row";

interface HttpAnswer {
  status: number;
  contentType: string | undefined;
  body: string;
}

/** The `message` of a JSON error body; undefined for anything else (an SSE stream, as the route answered before RX-178 B1). */
const messageOf = (body: string): unknown => {
  try {
    return JSON.parse(body).message;
  } catch {
    return undefined;
  }
};

/** One request to the listening app over a real socket; resolves when the response has ended. */
const send = (params: { url: string; headers: Record<string, string>; body: unknown }) =>
  new Promise<HttpAnswer>((resolve, reject) => {
    const payload = JSON.stringify(params.body);
    const req = httpRequest(
      params.url,
      { method: "POST", headers: { ...params.headers, "content-type": "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, contentType: res.headers["content-type"], body }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });

describe("RX-178 review B1: the agent chat route refuses an unusable model before any work (Fastify, test database)", () => {
  let provider: StubHttpServer;
  let envStub: StubHttpServer;
  let blocker: OutboundBlocker;
  let restoreEnv: () => void;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let appUrl: string;

  beforeAll(async () => {
    [provider, envStub] = await Promise.all([startStubHttpServer(), startStubHttpServer()]);
    restoreEnv = pointLlmAtStubs({ primary: envStub, apiKey: "rx178-marker-key-not-real-env" });
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ProvidersModule],
      controllers: [AgentRunController],
      providers: [
        AgentRunService,
        AgentRunMeterService,
        CreditService,
        PlatformSettingsService,
        ModelRegistryService,
        {
          provide: AgentToolService,
          useValue: {
            buildToolSchemasWithMcp: async () => [],
            cleanupMcpConnections: async () => undefined,
            clearLastDocumentResult: () => undefined,
            getLastDocumentResult: () => null,
          },
        },
        { provide: AgentMemoryService, useValue: { getMemoryContext: async () => "" } },
        { provide: KnowledgeService, useValue: {} },
        { provide: WorkspaceKnowledgeService, useValue: {} },
        { provide: UsageService, useValue: { logUsage: async () => undefined } },
        { provide: GuardrailService, useValue: { checkInput: async () => ({ blocked: false }) } },
        { provide: DocumentService, useValue: {} },
      ],
    }));
    app = await createFastifyApp(moduleRef);
    await app.listen(0, "127.0.0.1");
    appUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    blocker = blockOutbound();
    for (const stub of [provider, envStub]) {
      stub.requests.length = 0;
      stub.respond((_r, res) => sendJson(res, 200, chatCompletion("none")));
    }
    await resetDatabase(prisma);
    // A usable cheapest Standard model: the document-intent classifier would call it.
    await createResolvableModel(prisma, { slug: "fake/usable-standard", provider: { baseUrl: provider.baseUrl, apiKey: RECORD_KEY } });
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

  const cases: [string, () => Promise<string>][] = [
    ["an agent that stores a slug with no model row", async () => OLD_SLUG],
    [
      "an agent whose model's provider is inactive",
      async () => {
        await createResolvableModel(prisma, {
          slug: "fake/on-inactive-provider",
          provider: { baseUrl: provider.baseUrl, apiKey: RECORD_KEY, status: "inactive" },
        });
        return "fake/on-inactive-provider";
      },
    ],
  ];

  it.each(cases)("%s → 400 with the fixed text; no upstream call (classifier included), no quota, run or message", async (_name, arrangeSlug) => {
    const slug = await arrangeSlug();
    await moduleRef.get(ModelRegistryService).refresh();
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    const agent = await createAgent(prisma, { userId: user.id, model: slug });
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);

    const res = await send({
      url: `${appUrl}/agents/${agent.id}/chat`,
      headers: { authorization: `Bearer ${token}` },
      body: { message: "Hi" },
    });

    expect({ status: res.status, message: messageOf(res.body), echoesSlug: res.body.includes(slug) }).toEqual({
      status: 400,
      message: MODEL_UNAVAILABLE_MESSAGE,
      echoesSlug: false,
    });
    expect([provider.requests.length, envStub.requests.length]).toEqual([0, 0]);
    expect([await prisma.agentRun.count(), await prisma.agentMessage.count()]).toEqual([0, 0]);
  });

  // RNX-208 (D197, D208): a provider error body (a planted marker and a fake key suffix, as a 401 can echo, RX-174)
  // reaches no log line and no SSE line of the agent chat route; the client still gets an SSE error naming the status.
  it.each([401, 400])("RNX-208: the provider answers %i with a marker in its body → the marker is in no log line and no SSE line", async (status) => {
    const marker = `LEAK-MARKER-${randomUUID()}`;
    const isLeak = (text: string) => text.includes(marker) || text.includes("FAKE1234");
    const logs = captureLogs();
    provider.respond((_r, res) => sendJson(res, status, { error: { message: `Incorrect API key provided: ${marker} ...sk-or-v1-FAKE1234`, code: status } }));
    await prisma.tierRate.create({ data: { tier: "standard", inputCreditsPerToken: 1, cachedCreditsPerToken: 1, outputCreditsPerToken: 1 } });
    await moduleRef.get(ModelRegistryService).refresh();
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    await createSubscription(prisma, { userId: user.id, planId: plan.id });
    await fundPaidWallet(prisma, user.id, "1");
    const agent = await createAgent(prisma, { userId: user.id, model: "fake/usable-standard" });
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);

    const res = await send({ url: `${appUrl}/agents/${agent.id}/chat`, headers: { authorization: `Bearer ${token}` }, body: { message: "Hi" } });

    expect(provider.requests.length).toBeGreaterThan(1); // the classifier and the run both reached the stub
    expect({
      leakingLogLines: logs.lines.filter(isLeak),
      leakingSseLines: res.body.split("\n").filter(isLeak),
      clientMessages: sseErrorMessages(res.body),
    }).toEqual({ leakingLogLines: [], leakingSseLines: [], clientMessages: [expect.stringContaining(String(status))] });
  });
});
