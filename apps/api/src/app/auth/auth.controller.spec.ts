import { Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as bcrypt from "bcrypt";
import { AuthModule } from "./auth.module";
import { JWT_LIFETIME_SECONDS } from "./auth-cookie";
import { PrismaService } from "../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";

// better-auth is ESM-only; BetterAuthController and the guards import it.
jest.mock("../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

process.env.JWT_SECRET = "rx68-test-jwt-secret";

const PASSWORD = "correct-horse-battery";

describe("email auth cookie (RX-68, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  const savedEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN,
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        AuthModule,
      ],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    delete process.env.AUTH_COOKIE_DOMAIN;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  afterAll(() => app?.close());

  const setCookies = (res: { headers: Record<string, unknown> }) => {
    const header = res.headers["set-cookie"];
    if (header === undefined) return [];
    return Array.isArray(header) ? header : [header];
  };

  const login = async (email: string, password = PASSWORD) =>
    app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });

  const withPassword = async () =>
    createUser(prisma, { password: await bcrypt.hash(PASSWORD, 4) });

  it("login sets one httpOnly jwt cookie with the body's token (no Secure, no Domain in dev)", async () => {
    const user = await withPassword();

    const res = await login(user.email);

    expect(res.statusCode).toBe(200);
    expect(setCookies(res)).toEqual([
      `jwt=${res.json().token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${JWT_LIFETIME_SECONDS}`,
    ]);
  });

  it("the cookie's Max-Age matches the JWT's lifetime", async () => {
    const user = await withPassword();

    const res = await login(user.email);

    const { iat, exp } = JSON.parse(
      Buffer.from(res.json().token.split(".")[1], "base64url").toString(),
    );
    expect(exp - iat).toBe(JWT_LIFETIME_SECONDS);
    expect(JWT_LIFETIME_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("in production the cookie is also Secure", async () => {
    process.env.NODE_ENV = "production";
    const user = await withPassword();

    const res = await login(user.email);

    expect(setCookies(res)).toEqual([
      `jwt=${res.json().token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${JWT_LIFETIME_SECONDS}; Secure`,
    ]);
  });

  it("with AUTH_COOKIE_DOMAIN set the cookie carries that Domain", async () => {
    process.env.AUTH_COOKIE_DOMAIN = ".renovix.test";
    const user = await withPassword();

    const res = await login(user.email);

    expect(setCookies(res)).toEqual([
      `jwt=${res.json().token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${JWT_LIFETIME_SECONDS}; Domain=.renovix.test`,
    ]);
  });

  it("register sets the same cookie with the body's token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "new-user@test.local", password: PASSWORD },
    });

    expect(res.statusCode).toBe(201);
    expect(setCookies(res)).toEqual([
      `jwt=${res.json().token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${JWT_LIFETIME_SECONDS}`,
    ]);
  });

  it("login with a wrong password sets no cookie", async () => {
    const user = await withPassword();

    const res = await login(user.email, "wrong-password-123");

    expect(res.statusCode).toBe(401);
    expect(setCookies(res)).toEqual([]);
  });

  it("login with an unknown user sets no cookie", async () => {
    const res = await login("nobody@test.local");

    expect(res.statusCode).toBe(401);
    expect(setCookies(res)).toEqual([]);
  });

  it("register with an invalid payload sets no cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "short" },
    });

    expect(res.statusCode).toBe(400);
    expect(setCookies(res)).toEqual([]);
  });

  it("register with an existing email sets no cookie", async () => {
    const user = await withPassword();

    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: user.email, password: PASSWORD },
    });

    expect(res.statusCode).toBe(409);
    expect(setCookies(res)).toEqual([]);
  });

  it("logout clears the cookie with the same attributes", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/logout" });

    expect(res.statusCode).toBe(204);
    expect(setCookies(res)).toEqual([
      "jwt=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    ]);
  });

  it("logout in production with AUTH_COOKIE_DOMAIN clears the Secure, Domain cookie", async () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_COOKIE_DOMAIN = ".renovix.test";

    const res = await app.inject({ method: "POST", url: "/auth/logout" });

    expect(setCookies(res)).toEqual([
      "jwt=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure; Domain=.renovix.test",
    ]);
  });

  it("the token never reaches the logs", async () => {
    const methods = ["log", "error", "warn", "debug", "verbose", "fatal"] as const;
    const spies = methods.flatMap((m) => [
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
      jest.spyOn(Logger, m).mockImplementation(() => undefined),
    ]);
    const user = await withPassword();

    const res = await login(user.email);

    const token: string = res.json().token;
    expect(token).toBeTruthy();
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(token);
  });
});
