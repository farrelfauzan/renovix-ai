import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { AuthModule } from "../auth.module";
import { BetterAuthTestApp, startBetterAuthApp } from "../../../../test/better-auth-app";

// RNX-336: a revoked session is refused at once by the session guard, even while its device still holds a valid
// Better Auth cookie cache (session_data, 5 minutes). Real lib/auth and better-auth on the test database, behind the
// real AuthModule and AccessGuard. Made-up email address and password only.
jest.mock("better-auth", () => require("../../../../test/real-better-auth").requireNative("better-auth"));
jest.mock("better-auth/adapters/prisma", () =>
  require("../../../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("../../../lib/auth", () => require("../../../../test/real-better-auth").loadLibAuth());

const EMAIL = "rnx336-two-devices@renovix.test";
const PASSWORD = "rnx336-made-up-password";
/** Better Auth's session token cookie name outside production. */
const SESSION_COOKIE = "better-auth.session_token";
/** A trusted origin in test (CORS_ORIGIN unset: the local origins); Better Auth checks it on a cookie POST. */
const CHAT_ORIGIN = "http://localhost:3000";

/** The name=value pairs of every cookie a response set: the session token and the cookie cache. */
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

describe("RNX-336: a revoked session is refused at once (Fastify, test database)", () => {
  let started: BetterAuthTestApp;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    started = await startBetterAuthApp({ imports: [AuthModule] });
    app = started.app;
  });

  afterAll(() => app?.close());

  const post = (url: string, payload: object, cookie?: string) =>
    app.inject({ method: "POST", url, payload, headers: cookie ? { cookie, origin: CHAT_ORIGIN } : {} });
  const signIn = async (): Promise<string> =>
    cookiesOf(await post("/api/auth/better/sign-in/email", { email: EMAIL, password: PASSWORD }));
  /** GET /auth/me, a session route behind CombinedAuthGuard. */
  const me = (cookie: string) => app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });

  it("AC1: device A revokes device B; B's next request is 401 although its cookie cache is still valid, A keeps working", async () => {
    await post("/api/auth/better/sign-up/email", { email: EMAIL, password: PASSWORD, name: "RNX-336" });
    const deviceA = await signIn();
    const deviceB = await signIn();
    expect(deviceB).toContain("better-auth.session_data=");
    expect((await me(deviceB)).statusCode).toBe(200);

    const revoke = await post("/api/auth/better/revoke-session", { token: sessionTokenOf(deviceB) }, deviceA);
    const afterB = await me(deviceB);
    const afterA = await me(deviceA);

    expect(revoke.statusCode).toBe(200);
    expect(await started.prisma.session.count({ where: { token: sessionTokenOf(deviceB) } })).toBe(0);
    expect(afterB.statusCode).toBe(401);
    expect([afterA.statusCode, afterA.json().email]).toEqual([200, EMAIL]);
  });
});
