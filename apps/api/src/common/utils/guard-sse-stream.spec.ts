import { BadRequestException, Controller, Logger, Post, Res } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply } from "fastify";
import { guardSseStream } from "./guard-sse-stream";
import { Access } from "../decorators/access.decorator";
import { HealthController } from "../../app/health/controller/health.controller";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { captureLogs, requestOverSocket, sseErrorMessages } from "../../../test/sse-client";

// RNX-171 AC1: a test-only SSE route, wrapped by the stream guard as every SSE route is, sends its headers and then
// throws inside its own catch. Jest fails the running test on any uncaught exception or unhandled rejection, so a
// green test also means none was raised.

const MARKER_SECRET = "rnx171-marker-key-not-real";

@Controller("rnx171-guard")
class GuardedStreamTestController {
  private readonly logger = new Logger(GuardedStreamTestController.name);

  @Post("throw-in-catch")
  @Access({ public: true, reason: "RNX-171 test-only route" })
  async throwInCatch(@Res() res: FastifyReply): Promise<void> {
    return guardSseStream({
      response: res.raw,
      logger: this.logger,
      stream: async () => {
        res.raw.writeHead(200, { "Content-Type": "text/event-stream" });
        try {
          res.raw.write(`data: ${JSON.stringify({ status: "understanding" })}\n\n`);
          throw new Error(`provider failed, api key ${MARKER_SECRET}`);
        } catch (error) {
          throw new Error(`the catch failed too: ${(error as Error).message}`);
        }
      },
    });
  }

  @Post("throw-before-headers")
  @Access({ public: true, reason: "RNX-171 test-only route" })
  async throwBeforeHeaders(@Res() res: FastifyReply): Promise<void> {
    return guardSseStream({
      response: res.raw,
      logger: this.logger,
      stream: async () => {
        throw new BadRequestException("Invalid request body");
      },
    });
  }
}

describe("RNX-171 AC1: the SSE stream guard (test-only route, Fastify, real socket)", () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef } = await createTestModule({ controllers: [GuardedStreamTestController, HealthController] }));
    app = await createFastifyApp(moduleRef);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  const expectHealthy = async () => {
    const health = await requestOverSocket(app, { method: "GET", path: "/health" });
    expect([health.statusCode, JSON.parse(health.body)]).toEqual([200, { status: "ok", database: "connected" }]);
  };

  it("a throw inside the route's catch after the headers → one error event, the stream ends, health answers; no secret logged", async () => {
    const { lines } = captureLogs();

    const res = await requestOverSocket(app, { method: "POST", path: "/rnx171-guard/throw-in-catch", body: {} });

    expect([res.statusCode, res.contentType, res.ended]).toEqual([200, "text/event-stream", true]);
    expect(sseErrorMessages(res.body)).toEqual(["The response failed. Please try again."]);
    expect(res.body).not.toContain(MARKER_SECRET);
    expect(lines).toContain("SSE stream ended by an error after its headers were sent (Error)");
    expect(lines.filter((l) => l.includes(MARKER_SECRET) || l.includes("ERR_HTTP_HEADERS_SENT"))).toEqual([]);
    await expectHealthy();
  }, 15000);

  it("a throw before the headers is answered as before (400 with Nest's body), not as a stream", async () => {
    const res = await requestOverSocket(app, { method: "POST", path: "/rnx171-guard/throw-before-headers", body: {} });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ statusCode: 400, message: "Invalid request body", error: "Bad Request" });
    await expectHealthy();
  }, 15000);
});
