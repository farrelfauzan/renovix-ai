import { randomUUID } from "node:crypto";
import { Body, Controller, Logger, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createFastifyAdapter } from "../utils/create-fastify-adapter";
import { AppLogger } from "./app-logger";

// RNX-17 AC2: no log line holds a planted bearer token, API key, cookie value, password or provider key, in JSON and
// in the readable format. No route logs request headers today, so this probe route logs them the ways code could:
// the headers and body as objects, an axios-like error carrying them, strings with them written in, and a thrown
// error with the token in its message (logged by Nest's ExceptionsHandler). Nest's Logger is not mocked: the lines
// are what the real logger writes to stdout and stderr.

const unique = () => randomUUID().replace(/-/g, "");
const PLANTED = {
  bearer: `plantedbearer${unique()}`,
  apiKey: `sk_live_planted${unique()}`,
  bodyApiKey: `sk_live_plantedbody${unique()}`,
  cookie: `plantedcookie${unique()}`,
  password: `plantedpassword${unique()}`,
  providerKey: `sk-or-v1-planted${unique()}`,
};

@Controller("log-probe")
class LogProbeController {
  private readonly logger = new Logger(LogProbeController.name);

  @Post()
  probe(@Req() req: FastifyRequest, @Body() body: Record<string, unknown>): never {
    const { authorization, cookie } = req.headers;
    this.logger.warn({ headers: req.headers, body });
    this.logger.log(`Retrying with headers ${JSON.stringify(req.headers)} and body ${JSON.stringify(body)}`);
    this.logger.warn(`Auth failed, Authorization: ${authorization}, Cookie: ${cookie}`);
    const upstream = Object.assign(new Error(`Incorrect API key provided: ${PLANTED.providerKey}`), {
      config: { headers: { Authorization: `Bearer ${PLANTED.providerKey}` } },
    });
    this.logger.error("Provider call failed", upstream);
    this.logger.error(new Error(`password=${PLANTED.password} apiKey=${PLANTED.bodyApiKey}`));
    throw new Error(`Session lookup failed for ${authorization} with cookie=${cookie}`);
  }
}

/** Every line the logger writes to stdout or stderr while `act` runs (the writes are swallowed). */
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

describe.each([
  ["JSON", true],
  ["readable", false],
])("RNX-17 AC2: planted secrets in no log line (%s format)", (_format, json) => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [LogProbeController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter());
    app.useLogger(new AppLogger({ json, logLevels: ["log", "error", "warn", "debug", "verbose", "fatal"] }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("the bearer token, API keys, cookie, password and provider key appear in no line, in full or in part", async () => {
    let status = 0;

    const lines = await captureOutput(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/log-probe",
        headers: {
          authorization: `Bearer ${PLANTED.bearer}`,
          "x-api-key": PLANTED.apiKey,
          cookie: `better-auth.session_token=${PLANTED.cookie}; theme=dark`,
        },
        payload: { apiKey: PLANTED.bodyApiKey, password: PLANTED.password, provider: { apiKey: PLANTED.providerKey } },
      });
      status = res.statusCode;
    });

    // A planted value's random part (32 hex characters) or any 8-character piece of it.
    const pieces = Object.values(PLANTED).flatMap((value) => {
      const random = value.slice(-32);
      return [random, random.slice(0, 8), random.slice(12, 20), random.slice(-8)];
    });
    expect(status).toBe(500);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.filter((line) => pieces.some((piece) => line.includes(piece)))).toEqual([]);
    expect(lines.filter((line) => line.includes("[REDACTED]")).length).toBeGreaterThanOrEqual(6);
  });
});
