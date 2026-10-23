import { Controller, Get } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { buildCorsOptions } from "./build-cors-options";
import { createFastifyAdapter } from "./create-fastify-adapter";

const CHAT_ORIGIN = "https://chat.example.test";
const EVIL_ORIGIN = "https://evil.example.test";
const ADMIN_ORIGIN = "https://admin.example.test";

@Controller("cors-probe")
class CorsProbeController {
  @Get()
  read(): { ok: boolean } {
    return { ok: true };
  }
}

/** A Fastify app with main.ts's CORS options for `env`, as NestFactory.create gets them (the `cors` app option). */
async function startApp(env: NodeJS.ProcessEnv): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [CorsProbeController] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { cors: buildCorsOptions(env) });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** A credentialed GET and a preflight from `origin`. */
async function requestFrom(app: NestFastifyApplication, origin: string) {
  const simple = await app.inject({ method: "GET", url: "/cors-probe", headers: { origin, cookie: "session=x" } });
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/cors-probe",
    headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
  return { simple, preflight };
}

describe("RNX-70: the API's CORS options on Fastify", () => {
  describe("production with CORS_ORIGIN set to the chat origin", () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await startApp({ NODE_ENV: "production", CORS_ORIGIN: CHAT_ORIGIN, ADMIN_ORIGIN });
    });

    afterAll(async () => {
      await app.close();
    });

    it("AC2 negative: a credentialed request and a preflight from another origin get no Access-Control-Allow-Origin", async () => {
      const { simple, preflight } = await requestFrom(app, EVIL_ORIGIN);

      expect(simple.headers["access-control-allow-origin"]).toBeUndefined();
      expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("AC2 control: the chat origin is allowed with credentials, also on the preflight", async () => {
      const { simple, preflight } = await requestFrom(app, CHAT_ORIGIN);

      expect(simple.headers["access-control-allow-origin"]).toBe(CHAT_ORIGIN);
      expect(simple.headers["access-control-allow-credentials"]).toBe("true");
      expect(preflight.headers["access-control-allow-origin"]).toBe(CHAT_ORIGIN);
      expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    });
  });

  it.each([
    ["missing", { NODE_ENV: "production", ADMIN_ORIGIN }],
    ["a wildcard", { NODE_ENV: "production", CORS_ORIGIN: "*", ADMIN_ORIGIN }],
  ])("AC1/AC2 negative: production with CORS_ORIGIN %s gets no options, so no app reflects every origin", (_label, inputEnv) => {
    expect(() => buildCorsOptions(inputEnv)).toThrow("CORS_ORIGIN");
  });

  describe("development without CORS_ORIGIN", () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await startApp({ NODE_ENV: "development", ADMIN_ORIGIN });
    });

    afterAll(async () => {
      await app.close();
    });

    it("AC3 control: any origin is reflected with credentials, as before", async () => {
      const { simple, preflight } = await requestFrom(app, EVIL_ORIGIN);

      expect(simple.headers["access-control-allow-origin"]).toBe(EVIL_ORIGIN);
      expect(simple.headers["access-control-allow-credentials"]).toBe("true");
      expect(preflight.headers["access-control-allow-origin"]).toBe(EVIL_ORIGIN);
    });
  });
});
