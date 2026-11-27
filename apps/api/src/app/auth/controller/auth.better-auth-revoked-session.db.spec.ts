import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { BetterAuthTestApp, startBetterAuthApp } from "../../../../test/better-auth-app";

// RNX-379: Better Auth's own endpoints (/api/auth/better/*) refuse a revoked session at once: lib/auth turns the
// session cookie cache off, so get-session and update-user read the session row instead of a cached cookie. Real
// lib/auth and better-auth on the test database, behind the real BetterAuthController. Made-up email and password.
jest.mock("better-auth", () => require("../../../../test/real-better-auth").requireNative("better-auth"));
jest.mock("better-auth/adapters/prisma", () =>
  require("../../../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("../../../lib/auth", () => require("../../../../test/real-better-auth").loadLibAuth());

const EMAIL = "rnx379-two-sessions@renovix.test";
const PASSWORD = "rnx379-made-up-password";
/** Better Auth's session token cookie name outside production. */
const SESSION_COOKIE = "better-auth.session_token";
/** A trusted origin in test (CORS_ORIGIN unset: the local origins); Better Auth checks it on a cookie POST. */
const CHAT_ORIGIN = "http://localhost:3000";

/** The name=value pairs of every cookie a response set. */
const cookiesOf = (res: LightMyRequestResponse): string => {
  const header = res.headers["set-cookie"];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return lines.map((line) => line.split(";")[0]).join("; ");
};

/** The session token (the part before the signature) in a cookie header. */
const sessionTokenOf = (cookie: string): string => {
  const pair = cookie.split("; ").find((part) => part.startsWith(`${SESSION_COOKIE}=`)) ?? "";
  return decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)).split(".")[0];
};

describe("RNX-379: Better Auth's endpoints refuse a revoked session at once (Fastify, test database)", () => {
  let started: BetterAuthTestApp;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    started = await startBetterAuthApp();
    app = started.app;
  });

  afterAll(() => app?.close());

  const post = (path: string, payload: object, cookie?: string) =>
    app.inject({ method: "POST", url: `/api/auth/better${path}`, payload, headers: cookie ? { cookie, origin: CHAT_ORIGIN } : {} });
  const signIn = async (): Promise<string> => cookiesOf(await post("/sign-in/email", { email: EMAIL, password: PASSWORD }));
  const getSession = (cookie: string) => app.inject({ method: "GET", url: "/api/auth/better/get-session", headers: { cookie } });

  it("AC1: session A revokes session B; B's next get-session is no session and its next update-user is a 401, A's identical calls keep working", async () => {
    await post("/sign-up/email", { email: EMAIL, password: PASSWORD, name: "RNX-379" });
    const sessionA = await signIn();
    const sessionB = await signIn();
    expect((await getSession(sessionB)).json()).toMatchObject({ user: { email: EMAIL } });

    const revoke = await post("/revoke-session", { token: sessionTokenOf(sessionB) }, sessionA);
    const getSessionB = await getSession(sessionB);
    const updateUserB = await post("/update-user", { name: "RNX-379 renamed by B" }, sessionB);
    const updateUserA = await post("/update-user", { name: "RNX-379 renamed by A" }, sessionA);
    const getSessionA = await getSession(sessionA);

    expect(revoke.statusCode).toBe(200);
    expect(await started.prisma.session.count({ where: { token: sessionTokenOf(sessionB) } })).toBe(0);
    expect([getSessionB.statusCode, getSessionB.json()]).toEqual([200, null]);
    expect([updateUserB.statusCode, updateUserB.json().code]).toEqual([401, "UNAUTHORIZED"]);
    expect(updateUserA.statusCode).toBe(200);
    expect(getSessionA.json()).toMatchObject({ user: { email: EMAIL, name: "RNX-379 renamed by A" } });
    expect((await started.prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).name).toBe("RNX-379 renamed by A");
  });
});
