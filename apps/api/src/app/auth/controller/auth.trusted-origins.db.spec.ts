import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { AuthModule } from "../auth.module";
import { createAppLogger } from "../../../common/utils/create-app-logger";
import { BetterAuthTestApp, startBetterAuthApp } from "../../../../test/better-auth-app";

// RNX-277: Better Auth refuses a sign-in and a sign-out POST whose Origin is not trusted, and its trusted
// origins are the same allowed-origins list as CORS and UserOriginGuard (CORS_ORIGIN + ADMIN_ORIGIN), never a
// localhost fallback. Real lib/auth and better-auth on the test database, loaded with CORS_ORIGIN set to the
// product origins (the same list production uses), so localhost is NOT trusted here.
jest.mock("better-auth", () => require("../../../../test/real-better-auth").requireNative("better-auth"));
jest.mock("better-auth/adapters/prisma", () =>
  require("../../../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("../../../lib/auth", () =>
  require("../../../../test/real-better-auth").loadLibAuthWithOrigins({
    CORS_ORIGIN: "https://chat.renovix.id",
    ADMIN_ORIGIN: "https://admin.renovix.id",
  }),
);

const PASSWORD = "rnx277-made-up-password";
const SESSION_COOKIE = "better-auth.session_token";

describe("RNX-277: Better Auth refuses foreign-origin sign-in and sign-out (trusted origins = the CORS list)", () => {
  let started: BetterAuthTestApp;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    started = await startBetterAuthApp({ imports: [AuthModule] });
    app = started.app;
    app.useLogger(createAppLogger({ NODE_ENV: "production" }));
  });

  afterAll(async () => {
    delete process.env.CORS_ORIGIN;
    delete process.env.ADMIN_ORIGIN;
    await app?.close();
  });

  const post = (url: string, payload: object, headers: Record<string, string>) =>
    app.inject({ method: "POST", url, payload, headers });

  const signIn = (email: string, headers: Record<string, string>) =>
    post("/api/auth/better/sign-in/email", { email, password: PASSWORD }, headers);

  const signUp = (email: string) =>
    post("/api/auth/better/sign-up/email", { email, password: PASSWORD, name: "RNX-277" }, {});

  /** A signed-in user's session cookie line (from the Set-Cookie of a clean sign-in without Origin headers). */
  const sessionOf = async (email: string): Promise<string> => {
    await signUp(email);
    const res = await signIn(email, {});
    const line = (Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"]])
      .find((l: string | undefined) => l?.startsWith(`${SESSION_COOKIE}=`));
    if (!line) throw new Error(`no session cookie for ${email}: ${res.statusCode} ${res.body}`);
    return line.split(";")[0];
  };

  /** A browser-like sign-in: fetch-metadata headers present, so better-auth validates the Origin. */
  const browserSignIn = (email: string, origin: string) =>
    signIn(email, {
      origin,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    });

  it("a foreign-origin sign-in POST is refused (403) and sets no session cookie", async () => {
    await signUp("foreign-sign-in@renovix.test");
    const res = await browserSignIn("foreign-sign-in@renovix.test", "https://evil.example");

    expect(res.statusCode).toBe(403);
    const setCookie = res.headers["set-cookie"];
    const lines = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(lines.filter((l) => l.startsWith(`${SESSION_COOKIE}=`))).toEqual([]);
  });

  it("a localhost sign-in POST is refused when localhost is not in the trusted origins (no localhost fallback)", async () => {
    await signUp("localhost-sign-in@renovix.test");
    const res = await browserSignIn("localhost-sign-in@renovix.test", "http://localhost:4200");

    expect(res.statusCode).toBe(403);
  });

  it("a sign-in POST from an allowed origin works (control)", async () => {
    await signUp("allowed-sign-in@renovix.test");
    const res = await browserSignIn("allowed-sign-in@renovix.test", "https://chat.renovix.id");

    expect(res.statusCode).toBe(200);
    const lines = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"]];
    expect(lines.some((l) => l?.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
  });

  it("a foreign-origin sign-out POST is refused (403) and does not clear the session cookie", async () => {
    const cookie = await sessionOf("foreign-sign-out@renovix.test");

    const res: LightMyRequestResponse = await post("/api/auth/better/sign-out", {}, {
      origin: "https://evil.example",
      cookie,
      "content-type": "application/json",
    });

    expect(res.statusCode).toBe(403);
    const lines = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"]].filter(Boolean);
    // The session cookie must not be cleared: no Set-Cookie line expires/removes it.
    expect(lines.filter((l) => l?.startsWith(`${SESSION_COOKIE}=`))).toEqual([]);

    // and the session still opens a route
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it("a sign-out POST from an allowed origin works and clears the session (control)", async () => {
    const cookie = await sessionOf("allowed-sign-out@renovix.test");

    const res = await post("/api/auth/better/sign-out", {}, {
      origin: "https://chat.renovix.id",
      cookie,
      "content-type": "application/json",
    });

    expect(res.statusCode).toBe(200);
    const lines = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"]].filter(Boolean);
    const cleared = lines.find((l) => l?.startsWith(`${SESSION_COOKIE}=`));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});
