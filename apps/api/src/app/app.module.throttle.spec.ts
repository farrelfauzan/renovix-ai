import { Type } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { createFastifyApp } from "../../test/test-module";
import { testDatabaseUrl } from "../../test/test-database";
import { BACK_OFFICE_ORIGIN } from "../../test/admin-auth";

// RX-155: the throttler of the real AppModule counts per client with the D48 client-IP rule
// (CLIENT_IP_HEADER when set, otherwise the socket address; never X-Forwarded-For or request.ip).
// Started as in app.module.guards.spec.ts; nothing external runs.
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
// Required, not imported: see app.module.guards.spec.ts.
const { AppModule }: { AppModule: Type<unknown> } = require("./app.module");

/** @Throttle on POST /admin/auth/sign-in (admin-auth.controller.ts): 10 calls a minute per caller. */
const SIGN_IN_LIMIT = 10;
/** The one socket address every request comes from behind a load balancer. */
const PROXY = "10.0.0.1";
/** 10 answered sign-in attempts (an invalid body is 400), then 429. */
const TEN_THEN_429 = [...Array(SIGN_IN_LIMIT).fill(400), 429];

describe("RX-155: the real AppModule's throttler counts per client (D48 client-IP rule, Fastify)", () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;
  const original = process.env.CLIENT_IP_HEADER;

  /** One admin sign-in attempt from a socket address, with the given headers (plus the back-office Origin, RX-156). */
  const signIn = (remoteAddress: string, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
    app.inject({
      method: "POST",
      url: "/admin/auth/sign-in",
      remoteAddress,
      headers: { ...BACK_OFFICE_ORIGIN, ...headers },
      payload: { email: "not-an-email" },
    });

  /** The status codes of 11 sign-in attempts; `send(i)` makes attempt i. */
  const elevenAttempts = async (send: (i: number) => Promise<LightMyRequestResponse>): Promise<number[]> => {
    const statuses: number[] = [];
    for (let i = 0; i <= SIGN_IN_LIMIT; i++) statuses.push((await send(i)).statusCode);
    return statuses;
  };

  beforeAll(async () => {
    testDatabaseUrl(); // fails with a hint when the test database is not configured
    Object.assign(process.env, {
      LLM_PROVIDER: "fake",
      IP_HASH_SECRET: "rx155-test-secret",
      S3_BUCKET: "test-bucket",
      S3_REGION: "test-region",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
      S3_CDN_DOMAIN: "cdn.test.local",
    });
    delete process.env.OPENROUTER_API_KEY;
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createFastifyApp(moduleRef);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CLIENT_IP_HEADER;
    else process.env.CLIENT_IP_HEADER = original;
  });

  afterAll(() => app?.close());

  it("AC1: with CLIENT_IP_HEADER, two clients behind one proxy address each get 10 sign-in attempts, the 11th is 429", async () => {
    process.env.CLIENT_IP_HEADER = "x-client-ip";

    const first = await elevenAttempts(() => signIn(PROXY, { "x-client-ip": "198.51.100.1" }));
    const second = await elevenAttempts(() => signIn(PROXY, { "x-client-ip": "198.51.100.2" }));

    expect(first).toEqual(TEN_THEN_429);
    expect(second).toEqual(TEN_THEN_429);
  });

  it("AC2: with CLIENT_IP_HEADER, a different forged X-Forwarded-For (and proxy address) on each request still counts in one bucket", async () => {
    process.env.CLIENT_IP_HEADER = "x-client-ip";

    const statuses = await elevenAttempts((i) =>
      signIn(`10.0.1.${i}`, { "x-client-ip": "198.51.100.3", "x-forwarded-for": `203.0.113.${i}` }),
    );

    expect(statuses).toEqual(TEN_THEN_429);
  });

  it("AC3: without CLIENT_IP_HEADER, limits count per socket address and client-sent IP headers are ignored", async () => {
    delete process.env.CLIENT_IP_HEADER;
    const forged = (i: number): Record<string, string> => ({ "x-client-ip": `203.0.113.${i}`, "x-forwarded-for": `203.0.113.${i}` });

    const first = await elevenAttempts((i) => signIn("192.0.2.1", forged(i)));
    const second = await elevenAttempts((i) => signIn("192.0.2.2", forged(i)));

    expect(first).toEqual(TEN_THEN_429);
    expect(second).toEqual(TEN_THEN_429);
  });
});
