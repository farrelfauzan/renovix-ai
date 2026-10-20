import { Controller, Post, Res } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply } from "fastify";
import { ServerResponse } from "node:http";
import { Access } from "../decorators/access.decorator";
import { HealthController } from "../../app/health/controller/health.controller";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { captureLogs, requestOverSocket } from "../../../test/sse-client";

// RNX-171 AC2: the global exception filter (registered with APP_FILTER by AppModule and by createTestModule) on
// a reply whose SSE headers are already sent. A test-only route writes the headers itself and then throws, with
// no stream guard around it: the error reaches the filter. Jest fails the running test on any uncaught exception
// or unhandled rejection, so a green test also means none was raised.

const MARKER_SECRET = "rnx171-marker-session-not-real";

@Controller("rnx171-test")
class HeadersSentTestController {
  @Post("throw-after-headers")
  @Access({ public: true, reason: "RNX-171 test-only route" })
  async throwAfterHeaders(@Res() res: FastifyReply): Promise<void> {
    res.raw.writeHead(200, { "Content-Type": "text/event-stream" });
    res.raw.write(`data: ${JSON.stringify({ status: "understanding" })}\n\n`);
    throw new Error(`planted failure after the headers, token=${MARKER_SECRET}`);
  }
}

describe("RNX-171 AC2: global exception filter on a reply whose headers are already sent (Fastify, real socket)", () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef } = await createTestModule({ controllers: [HeadersSentTestController, HealthController] }));
    app = await createFastifyApp(moduleRef);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  it("the stream ends with what was written, no second writeHead (no ERR_HTTP_HEADERS_SENT logged), no secret logged, health answers", async () => {
    const { lines } = captureLogs();
    const writeHead = jest.spyOn(ServerResponse.prototype, "writeHead");

    const res = await requestOverSocket(app, { method: "POST", path: "/rnx171-test/throw-after-headers", body: {} });

    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe("text/event-stream");
    expect(res.ended).toBe(true);
    expect(res.body).toBe(`data: ${JSON.stringify({ status: "understanding" })}\n\n`);
    expect(writeHead).toHaveBeenCalledTimes(1);
    expect(lines.filter((l) => l.includes("ERR_HTTP_HEADERS_SENT"))).toEqual([]);
    expect(lines.filter((l) => l.includes(MARKER_SECRET))).toEqual([]);
    const health = await requestOverSocket(app, { method: "GET", path: "/health" });
    expect([health.statusCode, JSON.parse(health.body)]).toEqual([200, { status: "ok", database: "connected" }]);
  }, 15000);
});
