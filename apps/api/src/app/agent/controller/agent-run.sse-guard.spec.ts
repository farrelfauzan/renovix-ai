import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { AgentRunController } from "./agent-run.controller";
import { AgentRunService } from "../service/agent-run.service";
import { AgentToolService } from "../service/agent-tool.service";
import { DocumentService } from "../../document/service/document.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { HealthController } from "../../health/controller/health.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { captureLogs, requestOverSocket, sseErrorMessages } from "../../../../test/sse-client";

// RNX-171 AC3/AC4: POST /agents/:id/chat is wrapped by the SSE stream guard. The agent run throws a plain Error after
// the SSE headers, and the route's own catch then throws too (its "Agent chat error" log line throws): the client
// still gets an error event and the end of the stream, GET /health answers, and no token or cookie value is logged.
// Jest fails the running test on any uncaught exception or unhandled rejection, so a green test also means none was
// raised. The controller's collaborators are fakes; the auth guard is real (a user on the test database).
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

const MARKER_KEY = "rnx171-marker-key-not-real-agent";
const MARKER_COOKIE = "rnx171-marker-cookie-not-real-agent";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";

describe("RNX-171: the agent run stream guard (Fastify, real socket)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentRunController, HealthController],
      providers: [
        { provide: AgentRunService, useValue: { resolveAgentConnection: async () => ({ apiKey: MARKER_KEY }), chat: async () => ({}) } },
        { provide: AgentToolService, useValue: { clearLastDocumentResult: () => undefined, getLastDocumentResult: () => null } },
        { provide: DocumentService, useValue: {} },
        { provide: ProviderRouter, useValue: { chat: async () => ({ choices: [{ message: { content: "none" } }] }) } },
        { provide: ModelRegistryService, useValue: { resolveCheapestConnection: async () => ({ slug: "standard-cheap", apiKey: MARKER_KEY }) } },
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  it("the agent run throws after the headers, then the route's catch throws → error event, stream ends, health answers, no secret logged", async () => {
    const user = await createUser(prisma);
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);
    const logs = captureLogs({ when: /^Agent chat error/, error: new Error(`the route's catch failed, cookie=${MARKER_COOKIE}`) });
    const runChat = jest.spyOn(moduleRef.get(AgentRunService), "chat").mockImplementation(async () => {
      throw new Error("planted collaborator failure");
    });

    const res = await requestOverSocket(app, {
      method: "POST",
      path: `/agents/${AGENT_ID}/chat`,
      headers: { authorization: `Bearer ${token}`, cookie: `better-auth.session_token=${MARKER_COOKIE}` },
      body: { message: "Hi" },
    });

    expect(runChat).toHaveBeenCalledTimes(1);
    expect(logs.wasPlantedThrown()).toBe(true);
    expect([res.statusCode, res.contentType, res.ended]).toEqual([200, "text/event-stream", true]);
    expect(sseErrorMessages(res.body)).toEqual(["The response failed. Please try again."]);
    expect(logs.lines).toContain("SSE stream ended by an error after its headers were sent (Error)");
    expect(logs.lines.filter((l) => [MARKER_KEY, MARKER_COOKIE, token].some((s) => l.includes(s)) || l.includes("ERR_HTTP_HEADERS_SENT"))).toEqual([]);
    const health = await requestOverSocket(app, { method: "GET", path: "/health" });
    expect([health.statusCode, JSON.parse(health.body)]).toEqual([200, { status: "ok", database: "connected" }]);
  }, 15000);
});
