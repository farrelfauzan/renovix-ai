import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "../service/channel.service";
import { ChannelChatService } from "../service/channel-chat.service";
import { S3Service } from "../../knowledge/service/s3.service";
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

// RNX-42: POST /channels/:id/agents/:agentId/chat opens its stream with the SSE helper, whose heartbeat replaces the
// route's own. The app is started with main.ts's CORS options and CORS_ORIGIN set to one origin (D324), set before the
// module is built (UserOriginGuard reads it then). The chat's collaborators are fakes; the auth guard is real.
jest.mock("../../knowledge/service/s3.service", () => ({ S3Service: class {} }));
jest.mock("../../document/service/document.service", () => ({ DocumentService: class {} }));
jest.mock("../../agent/service/agent-tool.service", () => ({ AgentToolService: class {} }));
jest.mock("../../guardrail/service/guardrail.service", () => ({ GuardrailService: class {} }));

const ALLOWED_ORIGIN = "https://chat.rnx42.test";
const FOREIGN_ORIGIN = "https://evil.rnx42.test";
const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const CHAT_RESULT = { content: "Hello", assistantMessageId: null };

describe("RNX-42: the channel chat on the SSE helper (Fastify, test database)", () => {
  const savedCorsOrigin = process.env.CORS_ORIGIN;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.CORS_ORIGIN = ALLOWED_ORIGIN;
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ChannelController],
      providers: [
        { provide: ChannelService, useValue: {} },
        { provide: ChannelChatService, useValue: { assertRunCanStart: async () => undefined, chat: async () => CHAT_RESULT } },
        { provide: S3Service, useValue: {} },
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

  const path = `/channels/${CHANNEL_ID}/agents/${AGENT_ID}/chat`;

  const signedInHeaders = async (origin: string) => ({ ...asSessionUser(await createUser(prisma)), origin });

  const chat = async (origin: string) => requestSse(app, { method: "POST", path, headers: await signedInHeaders(origin), body: { message: "Hi" } });

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
      'data: {"status":"understanding"}\n\ndata: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"done":true}\n\ndata: [DONE]\n\n',
    );
  });

  it("AC6 control: the listed origin gets itself with credentials", async () => {
    const actual = await chat(ALLOWED_ORIGIN);

    expect([actual.headers["access-control-allow-origin"], actual.headers["access-control-allow-credentials"], actual.headers.vary]).toEqual([
      ALLOWED_ORIGIN,
      "true",
      "Origin",
    ]);
  });

  it("AC6 negative: an origin not in the list is not echoed (refused before the stream)", async () => {
    const actual = await chat(FOREIGN_ORIGIN);

    expect(actual.statusCode).toBe(403);
    expect(actual.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("AC4: the client leaves during the chat → the helper's signal is aborted and its heartbeat cleared", async () => {
    const open = jest.spyOn(SseStream.prototype, "open");
    const setIntervalSpy = jest.spyOn(global, "setInterval");
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    let finishChat!: () => void;
    const chatHeld = new Promise<void>((resolve) => (finishChat = resolve));
    jest.spyOn(moduleRef.get(ChannelChatService), "chat").mockImplementation(async () => {
      await chatHeld;
      return CHAT_RESULT as never;
    });
    try {
      await disconnectAfter(app, { method: "POST", path, headers: await signedInHeaders(ALLOWED_ORIGIN), body: { message: "Hi" }, waitFor: "understanding" });
      const sse = open.mock.contexts[0] as SseStream;

      const isAborted = await isAbortedWithin(sse.signal);

      expect(isAborted).toBe(true);
      const heartbeats = heartbeatTimersOf(setIntervalSpy, SSE_HEARTBEAT_INTERVAL_MS);
      expect(heartbeats).toHaveLength(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeats[0]);
    } finally {
      finishChat();
    }
  }, 10000);
});
