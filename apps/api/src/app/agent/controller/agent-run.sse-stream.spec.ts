import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AgentRunController } from "./agent-run.controller";
import { AgentRunService } from "../service/agent-run.service";
import { DocumentService } from "../../document/service/document.service";
import { ProviderRouter } from "../../providers/provider-router";
import { ModelRegistryService } from "../../config/model-registry.service";
import { PrismaService } from "../../prisma/prisma.service";
import { SseStream } from "../../../common/utils/sse-stream";
import { SSE_HEARTBEAT_INTERVAL_MS } from "../../../common/config/sse-heartbeat-interval-ms";
import { buildCorsOptions } from "../../../common/utils/build-cors-options";
import { createFastifyAdapter } from "../../../common/utils/create-fastify-adapter";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";
import { disconnectAfter, heartbeatTimersOf, isAbortedWithin, requestSse } from "../../../../test/sse-socket";

// RNX-42: POST /agents/:id/chat opens its stream with the SSE helper. The app is started with main.ts's CORS options
// and CORS_ORIGIN set to one origin (D324), set before the module is built (UserOriginGuard reads it then). The run's
// collaborators are fakes; the auth guard is real (a user on the test database).
jest.mock("../../knowledge/service/knowledge.service", () => ({ KnowledgeService: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));
jest.mock("../../usage/service/usage.service", () => ({ UsageService: class {} }));

const ALLOWED_ORIGIN = "https://chat.rnx42.test";
const FOREIGN_ORIGIN = "https://evil.rnx42.test";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_RESULT = { message: { content: "Hello" }, sessionId: "session-1", runId: "run-1" };

describe("RNX-42: the agent run on the SSE helper (Fastify, test database)", () => {
  const savedCorsOrigin = process.env.CORS_ORIGIN;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [AgentRunController],
      providers: [
        { provide: AgentRunService, useValue: { assertRunCanStart: async () => undefined, chat: async () => RUN_RESULT } },
        { provide: DocumentService, useValue: {} },
        { provide: ProviderRouter, useValue: { chat: async () => ({ choices: [{ message: { content: "none" } }] }) } },
        { provide: ModelRegistryService, useValue: { resolveCheapestConnection: async () => ({ slug: "standard-cheap" }) } },
      ],
    }));
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { cors: buildCorsOptions(process.env) });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    if (savedCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = savedCorsOrigin;
  });

  const signedInHeaders = async (origin: string) => ({ ...asSessionUser(await createUser(prisma)), origin });

  const chat = async (origin: string) =>
    requestSse(app, { method: "POST", path: `/agents/${AGENT_ID}/chat`, headers: await signedInHeaders(origin), body: { message: "Hi" } });

  it("AC1: the helper opens the stream: 200 with text/event-stream, no-cache and keep-alive; the events are unchanged", async () => {
    const open = jest.spyOn(SseStream.prototype, "open");

    const actual = await chat(ALLOWED_ORIGIN);

    expect(open).toHaveBeenCalledTimes(1);
    expect([actual.statusCode, actual.headers["content-type"], actual.headers["cache-control"], actual.headers.connection]).toEqual([
      200,
      "text/event-stream",
      "no-cache",
      "keep-alive",
    ]);
    expect(actual.body).toBe(
      'data: {"status":"understanding"}\n\ndata: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
        'data: {"sessionId":"session-1","runId":"run-1"}\n\ndata: [DONE]\n\n',
    );
  });

  it("AC6 control: the listed origin gets itself with credentials, no longer `*`", async () => {
    const actual = await chat(ALLOWED_ORIGIN);

    expect([actual.headers["access-control-allow-origin"], actual.headers["access-control-allow-credentials"], actual.headers.vary]).toEqual([
      ALLOWED_ORIGIN,
      "true",
      "Origin",
    ]);
  });

  it("AC6 negative: an origin not in the list gets no Access-Control-Allow-Origin (refused before the stream)", async () => {
    const actual = await chat(FOREIGN_ORIGIN);

    expect(actual.statusCode).toBe(403);
    expect(actual.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("AC4: the client leaves during the run → the helper's signal is aborted and its heartbeat cleared", async () => {
    const open = jest.spyOn(SseStream.prototype, "open");
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    let finishRun!: () => void;
    const runHeld = new Promise<void>((resolve) => (finishRun = resolve));
    jest.spyOn(moduleRef.get(AgentRunService), "chat").mockImplementation(async () => {
      await runHeld;
      return RUN_RESULT as never;
    });
    try {
      await disconnectAfter(app, {
        method: "POST",
        path: `/agents/${AGENT_ID}/chat`,
        headers: await signedInHeaders(ALLOWED_ORIGIN),
        body: { message: "Hi" },
        waitFor: "understanding",
      });
      const sse = open.mock.contexts[0] as SseStream;

      const isAborted = await isAbortedWithin(sse.signal);

      expect(isAborted).toBe(true);
      const heartbeats = heartbeatTimersOf(setIntervalSpy, SSE_HEARTBEAT_INTERVAL_MS);
      expect(heartbeats).toHaveLength(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeats[0]);
    } finally {
      finishRun();
    }
  }, 10000);
});
