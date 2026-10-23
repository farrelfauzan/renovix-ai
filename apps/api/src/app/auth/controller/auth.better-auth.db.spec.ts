import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import * as jwt from "jsonwebtoken";
import { AuthModule } from "../auth.module";
import { createAppLogger } from "../../../common/utils/create-app-logger";
import { BetterAuthTestApp, startBetterAuthApp } from "../../../../test/better-auth-app";
import { captureOutput } from "../../../../test/capture-output";

// RNX-225: email sign-up and sign-in go through Better Auth (/api/auth/better/sign-up/email, /sign-in/email); the
// login JWT routes (POST /auth/login, /auth/register, /auth/logout) are gone. Real lib/auth and better-auth on the
// test database (test/real-better-auth.ts, test/better-auth-app.ts), behind the real AuthModule and AccessGuard, with
// the production AppLogger (RX-68's "no token in the logs", now on the Better Auth session token). Made-up email
// addresses and passwords only.
jest.mock("better-auth", () => require("../../../../test/real-better-auth").requireNative("better-auth"));
jest.mock("better-auth/adapters/prisma", () =>
  require("../../../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("../../../lib/auth", () => require("../../../../test/real-better-auth").loadLibAuth());

const PASSWORD = "rnx225-made-up-password";
/** Better Auth's session cookie name outside production. */
const SESSION_COOKIE = "better-auth.session_token";

/** The Set-Cookie lines of a response. */
const setCookies = (res: LightMyRequestResponse): string[] => {
  const header = res.headers["set-cookie"];
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
};

/** The session cookie line a response set, if any. */
const sessionCookieLine = (res: LightMyRequestResponse): string | undefined =>
  setCookies(res).find((line) => line.startsWith(`${SESSION_COOKIE}=`));

describe("RNX-225: email auth through Better Auth; the login JWT routes are gone (Fastify, test database)", () => {
  let started: BetterAuthTestApp;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    started = await startBetterAuthApp({ imports: [AuthModule] });
    app = started.app;
    app.useLogger(createAppLogger({ NODE_ENV: "production" }));
  });

  afterAll(() => app?.close());

  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
  const signUp = (email: string) => post("/api/auth/better/sign-up/email", { email, password: PASSWORD, name: "RNX-225" });
  const signIn = (email: string, password = PASSWORD) => post("/api/auth/better/sign-in/email", { email, password });
  /** GET /auth/me (a session route) with the session cookie of a response's Set-Cookie (name=value only). */
  const me = (cookieLine?: string) =>
    app.inject({ method: "GET", url: "/api/auth/me", headers: cookieLine ? { cookie: cookieLine.split(";")[0] } : {} });

  it.each(["/api/auth/login", "/api/auth/register", "/api/auth/logout"])("POST %s: 404 (the route is gone)", async (url) => {
    await signUp(`gone-${url.split("/").pop()}@renovix.test`);

    const res = await post(url, { email: `gone-${url.split("/").pop()}@renovix.test`, password: PASSWORD });

    expect(res.statusCode).toBe(404);
    expect(setCookies(res).filter((line) => line.startsWith("jwt="))).toEqual([]);
  });

  it("sign-up sets an httpOnly session cookie that opens a session route; the account has its default workspace and no API key", async () => {
    const res = await signUp("sign-up@renovix.test");
    const cookie = sessionCookieLine(res);
    const profile = await me(cookie);

    expect(res.statusCode).toBe(200);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect([profile.statusCode, profile.json().email]).toEqual([200, "sign-up@renovix.test"]);
    expect(profile.json()).not.toHaveProperty("balance");
    expect(profile.json()).not.toHaveProperty("apiKey");
    const user = await started.prisma.user.findUniqueOrThrow({ where: { email: "sign-up@renovix.test" } });
    expect(await started.prisma.workspace.count({ where: { ownerId: user.id, isDefault: true } })).toBe(1);
    expect(await started.prisma.apiKey.count({ where: { userId: user.id } })).toBe(0);
  });

  it("sign-in sets an httpOnly session cookie that opens a session route", async () => {
    await signUp("sign-in@renovix.test");

    const res = await signIn("sign-in@renovix.test");
    const cookie = sessionCookieLine(res);
    const profile = await me(cookie);

    expect(res.statusCode).toBe(200);
    expect(cookie).toMatch(/; HttpOnly/);
    expect([profile.statusCode, profile.json().email]).toEqual([200, "sign-in@renovix.test"]);
  });

  it("a wrong password sets no session cookie, and the session route answers 401 without one", async () => {
    await signUp("wrong-password@renovix.test");

    const res = await signIn("wrong-password@renovix.test", "not-the-password");
    const profile = await me(sessionCookieLine(res));

    expect(res.statusCode).toBe(401);
    expect(sessionCookieLine(res)).toBeUndefined();
    expect(profile.statusCode).toBe(401);
  });

  describe("AC5: the session token never reaches the output (production AppLogger, stdout, stderr, console)", () => {
    /** The session cookie's value and the session token in it (the part before the signature). */
    const tokensOf = (cookieLine: string | undefined): string[] => {
      const value = decodeURIComponent((cookieLine ?? "").split(";")[0].slice(SESSION_COOKIE.length + 1));
      return [value, value.split(".")[0]].filter((token) => token.length > 0);
    };

    /**
     * Sign-up, sign-in, the session route with each session cookie and a wrong password, all while the output is
     * captured; `plant` runs inside the capture with the tokens (the control). Returns the captured lines that hold a
     * token, and the tokens.
     */
    const runCaptured = async (email: string, plant: (tokens: string[]) => void = () => undefined) => {
      const output = captureOutput();
      try {
        const signedUp = await signUp(email);
        const signedIn = await signIn(email);
        await me(sessionCookieLine(signedUp));
        await me(sessionCookieLine(signedIn));
        await signIn(email, "not-the-password");
        const tokens = [...tokensOf(sessionCookieLine(signedUp)), ...tokensOf(sessionCookieLine(signedIn))];
        plant(tokens);
        return { tokens, leaked: output.lines.filter((line) => tokens.some((token) => line.includes(token))) };
      } finally {
        jest.restoreAllMocks();
      }
    };

    it("no line printed during sign-up, sign-in and the session route holds the session token", async () => {
      const { tokens, leaked } = await runCaptured("no-token-in-logs@renovix.test");

      expect(tokens).toHaveLength(4);
      expect(leaked).toEqual([]);
    });

    it("control: a planted console.log(token) is caught", async () => {
      const { leaked } = await runCaptured("planted-log@renovix.test", (tokens) => console.log(`session ${tokens[1]}`));

      expect(leaked).toHaveLength(1);
    });
  });

  it("a login JWT of a real user on the session route: 401", async () => {
    await signUp("jwt@renovix.test");
    const user = await started.prisma.user.findUniqueOrThrow({ where: { email: "jwt@renovix.test" } });
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!);

    const res = await app.inject({ method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(401);
  });
});
