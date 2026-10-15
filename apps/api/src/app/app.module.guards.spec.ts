import { Type } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "./prisma/prisma.service";
import { createFastifyApp } from "../../test/test-module";
import { resetDatabase, testDatabaseUrl } from "../../test/test-database";
import { createUser } from "../../test/factories";

// RX-114: the real AppModule, started as it is (not through createTestModule,
// which registers the AccessGuard itself), on the test database. It shows that
// the app's own global guards are the throttler first, then the AccessGuard.
// Nothing external runs: LLM_PROVIDER=fake, the system knowledge base's S3
// client lists an empty bucket, and marked (ESM-only) is not used.
jest.mock("marked", () => ({}));
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = async () => ({ Contents: [] });
  },
  ListObjectsV2Command: class {},
  GetObjectCommand: class {},
  PutObjectCommand: class {},
  DeleteObjectCommand: class {},
}));
// AppModule is required, not imported: an import would put every file of the
// app into the spec type program (tsconfig.spec.json), which then reports the
// app's own type errors a second time; `tsc -p tsconfig.app.json` reports them.
const { AppModule }: { AppModule: Type<unknown> } = require("./app.module");

/** ThrottlerModule.forRoot in app.module.ts: 60 calls a minute for each route and caller. */
const THROTTLE_LIMIT = 60;

describe("RX-114: the global guards of the real AppModule (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    testDatabaseUrl(); // fails with a hint when the test database is not configured
    Object.assign(process.env, {
      LLM_PROVIDER: "fake",
      IP_HASH_SECRET: "rx114-test-secret",
      S3_BUCKET: "test-bucket",
      S3_REGION: "test-region",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      S3_CDN_DOMAIN: "cdn.test.local",
    });
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_API_KEY; // RX-160: fake mode refuses these keys too
    delete process.env.EMBEDDING_API_KEY;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    await resetDatabase(prisma);
    app = await createFastifyApp(moduleRef);
  });

  afterAll(() => app?.close());

  it("a public route answers without a credential", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
  });

  it("a jwt/session route: 401 without a credential, 403 with an API key, 200 with a login JWT", async () => {
    const user = await createUser(prisma, { apiKey: "sk_live_rx114-app" });
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);

    const anonymous = await app.inject({ method: "GET", url: "/agents" });
    const withKey = await app.inject({ method: "GET", url: "/agents", headers: { authorization: "Bearer sk_live_rx114-app" } });
    const withJwt = await app.inject({ method: "GET", url: "/agents", headers: { authorization: `Bearer ${token}` } });

    expect(anonymous.statusCode).toBe(401);
    expect(withKey.statusCode).toBe(403);
    expect(withJwt.statusCode).toBe(200);
  });

  it("an API key route and a portal route: 401 without their credential", async () => {
    const conversations = await app.inject({ method: "GET", url: "/conversations" });
    const portal = await app.inject({ method: "GET", url: "/chat/portal/models" });

    expect(conversations.statusCode).toBe(401);
    expect(portal.statusCode).toBe(401);
  });

  it("RX-156: an /admin route refuses a foreign Origin and a POST without Origin (403), and takes the back-office Origin", async () => {
    const signIn = (headers: Record<string, string>) =>
      app.inject({ method: "POST", url: "/admin/auth/sign-in", headers, payload: { email: "not-an-email" } });

    const product = await signIn({ origin: "https://chat.renovix.id" });
    const none = await signIn({});
    const backOffice = await signIn({ origin: process.env.ADMIN_ORIGIN! });

    expect([product.statusCode, none.statusCode, backOffice.statusCode]).toEqual([403, 403, 400]);
  });

  it("the throttler runs before the AccessGuard: call 61 without a credential is 429, not 401", async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= THROTTLE_LIMIT; i++) {
      statuses.push((await app.inject({ method: "GET", url: "/reminders" })).statusCode);
    }

    expect(statuses.slice(0, THROTTLE_LIMIT)).toEqual(new Array(THROTTLE_LIMIT).fill(401));
    expect(statuses[THROTTLE_LIMIT]).toBe(429);
  });
});
