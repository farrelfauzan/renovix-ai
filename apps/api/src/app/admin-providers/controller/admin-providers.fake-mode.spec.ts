import { ConfigModule } from "@nestjs/config";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminProvidersModule } from "../admin-providers.module";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";

// RX-177 AC4: with LLM_PROVIDER=fake (RX-88) the provider test goes to the canned fake that ProvidersModule
// installs itself (no override here), and no request leaves the machine: every outbound client is blocked.

// The module objects themselves (a namespace import's properties cannot be spied on).
const http: typeof import("http") = require("http");
const https: typeof import("https") = require("https");

const ENV_KEYS = ["LLM_PROVIDER", "OPENROUTER_API_KEY", "LLM_API_KEY", "EMBEDDING_API_KEY"] as const;
const savedEnv = ENV_KEYS.map((key) => process.env[key]);
const outbound: string[] = [];
const block = (name: string) => (): never => {
  outbound.push(name);
  throw new Error(`RX-177: outbound ${name} call in fake mode`);
};

describe("RX-177 AC4: POST /admin/providers/:id/test with LLM_PROVIDER=fake", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.LLM_PROVIDER = "fake";
    for (const key of ENV_KEYS.slice(1)) delete process.env[key];
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AdminAuthModule, AdminProvidersModule],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.spyOn(globalThis, "fetch").mockImplementation(block("fetch"));
    jest.spyOn(http, "request").mockImplementation(block("http.request"));
    jest.spyOn(https, "request").mockImplementation(block("https.request"));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    ENV_KEYS.forEach((key, i) => {
      if (savedEnv[i] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[i];
    });
  });

  it("control: the blocker catches fetch and https", () => {
    expect(() => fetch("https://fake-router.invalid/v1/chat/completions")).toThrow(/outbound fetch/);
    expect(() => https.request("https://fake-router.invalid")).toThrow(/outbound https.request/);
    expect(outbound.splice(0)).toEqual(["fetch", "https.request"]);
  });

  it("the test succeeds through the canned fake and nothing leaves the machine", async () => {
    const admin = await createAdmin(prisma, moduleRef, { email: "owner-rx177@example.com", role: "owner" });
    const { accessToken } = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    const headers = { ...BACK_OFFICE_ORIGIN, cookie: `rx_admin_access=${accessToken}` };
    const created = await app.inject({
      method: "POST",
      url: "/admin/providers",
      headers,
      payload: { type: "9router", name: "local-9router", baseUrl: "https://fake-router.invalid/v1", apiKey: "fake-key-rx177-ac4-Ab12" },
    });

    const tested = await app.inject({ method: "POST", url: `/admin/providers/${created.json().id}/test`, headers, payload: { slug: "cc/claude-sonnet-5" } });

    expect(created.statusCode).toBe(201);
    expect(tested.statusCode).toBe(200);
    expect(tested.json()).toEqual({ isSuccessful: true, reason: null, testedAt: expect.any(String) });
    expect(outbound).toEqual([]);
  });
});
