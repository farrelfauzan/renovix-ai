import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ConfigService } from "@nestjs/config";
import type { LightMyRequestResponse } from "fastify";
import { AuthModule } from "../auth.module";
import { auth } from "../../../lib/auth";
import { EmailScheduler } from "../../email/scheduler/email.scheduler";
import { EmailJobService } from "../../email/service/email-job.service";
import type { EmailService } from "../../email/service/email.service";
import { EmailTemplateService } from "../../email/service/email-template.service";
import { BetterAuthTestApp, startBetterAuthApp } from "../../../../test/better-auth-app";
import { resetDatabase } from "../../../../test/test-database";

// RNX-78: Settings > Sign-in and security on the real Better Auth (lib/auth.ts) and the real AuthModule, AccessGuard
// and CombinedAuthGuard, on the test database. Google is enabled with made-up client values and its two network steps
// (code exchange, user info) are replaced on the provider object, so no request leaves the process. Made-up email
// addresses and passwords only.
jest.mock("better-auth", () => require("../../../../test/real-better-auth").requireNative("better-auth"));
jest.mock("better-auth/adapters/prisma", () =>
  require("../../../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("../../../lib/auth", () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "rnx78-made-up-google-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "rnx78-made-up-google-client-secret";
  return require("../../../../test/real-better-auth").loadLibAuth("x-rnx78-client-ip");
});

const PASSWORD = "rnx78-made-up-password";
/** A trusted origin in test (CORS_ORIGIN unset: the local origins); Better Auth checks it on a cookie POST. */
const CHAT_ORIGIN = "http://localhost:3000";
const SETTINGS_URL = `${CHAT_ORIGIN}/settings/sign-in-security`;
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

/** The Google account the stubbed provider answers with on the next callback. */
interface GoogleUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** The profile picture the provider reports (Better Auth stores it as the user's avatar on sign-up). */
  readonly image?: string;
}
/** The two network steps of a social provider, replaced for the test. */
interface StubbableProvider {
  readonly id: string;
  validateAuthorizationCode: () => Promise<object>;
  getUserInfo: () => Promise<object>;
}

/** The name=value pairs of every cookie a response set (the session token and the cookie cache among them). */
const cookiesOf = (res: LightMyRequestResponse): string => {
  const header = res.headers["set-cookie"];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return lines.map((line) => line.split(";")[0]).join("; ");
};

/** The `state` query parameter of an OAuth authorization URL in a Better Auth answer. */
const stateOf = (res: LightMyRequestResponse): string => new URL(res.json().url).searchParams.get("state") ?? "";

describe("RNX-78: Settings > Sign-in and security (Fastify, real Better Auth, test database)", () => {
  let started: BetterAuthTestApp;
  let app: NestFastifyApplication;
  let nextGoogleUser: GoogleUser;

  beforeAll(async () => {
    started = await startBetterAuthApp({ imports: [AuthModule] });
    app = started.app;
    const context = (await auth.$context) as unknown as { socialProviders: StubbableProvider[] };
    const google = context.socialProviders.find((provider) => provider.id === "google") as StubbableProvider;
    google.validateAuthorizationCode = async () => ({ accessToken: "rnx78-made-up-access-token", scopes: [] });
    google.getUserInfo = async () => ({ user: { ...nextGoogleUser, emailVerified: true }, data: {} });
  });

  beforeEach(() => resetDatabase(started.prisma));

  afterAll(() => app?.close());

  const post = (url: string, payload: object, cookie?: string, userAgent = MAC_CHROME) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { "user-agent": userAgent, ...(cookie ? { cookie, origin: CHAT_ORIGIN } : {}) },
    });
  const get = (url: string, cookie?: string) => app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
  const signUp = (email: string) => post("/api/auth/better/sign-up/email", { email, password: PASSWORD, name: "RNX-78" });
  const signIn = async (email: string, userAgent = MAC_CHROME, password = PASSWORD): Promise<string> =>
    cookiesOf(await post("/api/auth/better/sign-in/email", { email, password }, undefined, userAgent));
  const signInStatus = async (email: string, password = PASSWORD): Promise<number> =>
    (await post("/api/auth/better/sign-in/email", { email, password })).statusCode;
  /** GET /auth/me, a session route behind CombinedAuthGuard. */
  const me = (cookie: string) => get("/api/auth/me", cookie);
  /** A new account signed up with Google only (the stubbed provider): its session cookie. */
  const signUpWithGoogle = async (googleUser: GoogleUser): Promise<string> => {
    nextGoogleUser = googleUser;
    const start = await post("/api/auth/better/sign-in/social", { provider: "google", callbackURL: SETTINGS_URL });
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/better/callback/google?code=rnx78-made-up-code&state=${stateOf(start)}`,
      headers: { cookie: cookiesOf(start), "user-agent": MAC_CHROME },
    });
    expect([callback.statusCode, callback.headers.location]).toEqual([302, SETTINGS_URL]);
    return cookiesOf(callback);
  };
  /** Links Google (the stubbed provider answering with `googleUser`) to the signed-in account; the callback's answer. */
  const linkGoogle = async (cookie: string, googleUser: GoogleUser): Promise<LightMyRequestResponse> => {
    nextGoogleUser = googleUser;
    const start = await post(
      "/api/auth/better/link-social",
      { provider: "google", callbackURL: SETTINGS_URL, errorCallbackURL: SETTINGS_URL },
      cookie,
    );
    expect(start.statusCode).toBe(200);
    return app.inject({
      method: "GET",
      url: `/api/auth/better/callback/google?code=rnx78-made-up-code&state=${stateOf(start)}`,
      headers: { cookie: `${cookie}; ${cookiesOf(start)}` },
    });
  };
  const googleAccounts = () => started.prisma.account.count({ where: { providerId: "google" } });

  it("AC1: a user with only Google linked cannot unlink it (control: once a password is set, Google can be unlinked)", async () => {
    const cookie = await signUpWithGoogle({ id: "google-ac1", email: "rnx78-ac1@renovix.test", name: "AC1" });

    const refused = await post("/api/auth/better/unlink-account", { providerId: "google" }, cookie);

    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe("FAILED_TO_UNLINK_LAST_ACCOUNT");
    expect(await googleAccounts()).toBe(1);
    expect((await post("/api/auth/password", { newPassword: PASSWORD }, cookie)).statusCode).toBe(204);
    expect((await post("/api/auth/better/unlink-account", { providerId: "google" }, cookie)).statusCode).toBe(200);
    expect(await googleAccounts()).toBe(0);
  });

  it("AC2: a password change without the current password, or with a wrong one, is refused and the password is unchanged", async () => {
    await signUp("rnx78-ac2@renovix.test");
    const cookie = await signIn("rnx78-ac2@renovix.test");
    const newPassword = "rnx78-made-up-new-password";

    const withoutCurrent = await post("/api/auth/better/change-password", { newPassword }, cookie);
    const withWrongCurrent = await post(
      "/api/auth/better/change-password",
      { newPassword, currentPassword: "rnx78-not-the-password" },
      cookie,
    );

    expect(withoutCurrent.statusCode).toBe(400);
    expect([withWrongCurrent.statusCode, withWrongCurrent.json().code]).toEqual([400, "INVALID_PASSWORD"]);
    expect(await signInStatus("rnx78-ac2@renovix.test", newPassword)).toBe(401);
    expect(await signInStatus("rnx78-ac2@renovix.test")).toBe(200);
  });

  it("AC3: after Sign out others, the other device's next request is refused at once although its cookie cache is valid; this one keeps working", async () => {
    await signUp("rnx78-ac3@renovix.test");
    const thisDevice = await signIn("rnx78-ac3@renovix.test", MAC_CHROME);
    const otherDevice = await signIn("rnx78-ac3@renovix.test", IPHONE_SAFARI);
    expect(otherDevice).toContain("better-auth.session_data=");
    expect((await me(otherDevice)).statusCode).toBe(200);

    const signOutOthers = await post("/api/auth/better/revoke-other-sessions", {}, thisDevice);
    const otherAfter = await me(otherDevice);
    const thisAfter = await me(thisDevice);

    expect(signOutOthers.statusCode).toBe(200);
    expect(otherAfter.statusCode).toBe(401);
    expect([thisAfter.statusCode, thisAfter.json().email]).toEqual([200, "rnx78-ac3@renovix.test"]);
    expect((await get("/api/auth/sessions", thisDevice)).json()).toEqual([expect.objectContaining({ isCurrent: true })]);
  });

  describe("AC4: one user can neither see nor end another user's sessions; the list holds no session token", () => {
    it("lists only the user's own sessions, with device and last-active time and no token, IP address or location", async () => {
      await signUp("rnx78-ac4-dewi@renovix.test");
      await signUp("rnx78-ac4-rina@renovix.test");
      await started.prisma.session.deleteMany();
      const dewiMac = await signIn("rnx78-ac4-dewi@renovix.test", MAC_CHROME);
      await signIn("rnx78-ac4-dewi@renovix.test", IPHONE_SAFARI);
      await signIn("rnx78-ac4-rina@renovix.test", MAC_CHROME);

      const listed = await get("/api/auth/sessions", dewiMac);

      expect(listed.statusCode).toBe(200);
      const rows = listed.json() as Record<string, unknown>[];
      const dewiSessionIds = (await started.prisma.session.findMany({ where: { user: { email: "rnx78-ac4-dewi@renovix.test" } } })).map(
        (session) => session.id,
      );
      expect(rows.map((row) => row.id).sort()).toEqual([...dewiSessionIds].sort());
      expect(rows.map((row) => Object.keys(row).sort())).toEqual([
        ["device", "id", "isCurrent", "lastActiveAt"],
        ["device", "id", "isCurrent", "lastActiveAt"],
      ]);
      expect(rows.map((row) => [row.device, row.isCurrent]).sort()).toEqual([
        ["Chrome on macOS", true],
        ["Safari on iPhone", false],
      ]);
      rows.forEach((row) => expect(Number.isNaN(Date.parse(String(row.lastActiveAt)))).toBe(false));
      const everyToken = (await started.prisma.session.findMany()).map((session) => session.token);
      expect(everyToken).toHaveLength(3);
      everyToken.forEach((token) => expect(listed.body).not.toContain(token));
    });

    it("Sign out others ends only the user's own other sessions, never another user's", async () => {
      await signUp("rnx78-ac4-dewi@renovix.test");
      await signUp("rnx78-ac4-rina@renovix.test");
      const dewiMac = await signIn("rnx78-ac4-dewi@renovix.test", MAC_CHROME);
      const rina = await signIn("rnx78-ac4-rina@renovix.test", MAC_CHROME);
      const rinaSessions = () => started.prisma.session.count({ where: { user: { email: "rnx78-ac4-rina@renovix.test" } } });
      const rinaSessionsBefore = await rinaSessions();

      const signOutOthers = await post("/api/auth/better/revoke-other-sessions", {}, dewiMac);

      expect(signOutOthers.statusCode).toBe(200);
      expect([(await me(rina)).statusCode, (await me(rina)).json().email]).toEqual([200, "rnx78-ac4-rina@renovix.test"]);
      expect(rinaSessionsBefore).toBe(2);
      expect(await rinaSessions()).toBe(rinaSessionsBefore);
      expect(await started.prisma.session.count({ where: { user: { email: "rnx78-ac4-dewi@renovix.test" } } })).toBe(1);
    });

    it("Better Auth's own /list-sessions (it answers with raw tokens) is switched off, and the list needs a session", async () => {
      await signUp("rnx78-ac4-dewi@renovix.test");
      const dewiMac = await signIn("rnx78-ac4-dewi@renovix.test");

      expect((await get("/api/auth/better/list-sessions", dewiMac)).statusCode).toBe(404);
      expect((await get("/api/auth/sessions")).statusCode).toBe(401);
    });
  });

  it("AC5: the new email is stored only through the link sent to it (one EmailJob row); then shown, and the old email cannot sign in", async () => {
    const oldEmail = "rnx78-ac5-old@renovix.test";
    const newEmail = "rnx78-ac5-new@renovix.test";
    await signUp(oldEmail);
    const cookie = await signIn(oldEmail);

    const requested = await post("/api/auth/better/change-email", { newEmail, callbackURL: SETTINGS_URL }, cookie);

    expect(requested.statusCode).toBe(200);
    const jobs = await started.prisma.emailJob.findMany();
    expect(jobs.map((job) => [job.type, job.recipientEmail, job.status])).toEqual([["email_change_verification", newEmail, "pending"]]);
    expect((await me(cookie)).json().email).toBe(oldEmail);
    expect(await signInStatus(newEmail)).toBe(401);
    const sent: { to: string; text: string }[] = [];
    const fakeMailer = { send: async (mail: { to: string; text: string }) => (sent.push(mail), { messageId: "rnx78-fake" }) };
    const noConfig = { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService;
    await new EmailScheduler(
      new EmailJobService(started.prisma),
      fakeMailer as unknown as EmailService,
      new EmailTemplateService(noConfig),
    ).processEmailJobs();
    expect(sent.map((mail) => mail.to)).toEqual([newEmail]);
    const link = new URL(sent[0].text.match(/http\S+verify-email\S+/)?.[0] ?? "");
    const confirmed = await get(`${link.pathname}${link.search}`, cookie);
    expect([confirmed.statusCode, confirmed.headers.location]).toEqual([302, SETTINGS_URL]);
    expect((await me(cookie)).json().email).toBe(newEmail);
    expect(await signInStatus(oldEmail)).toBe(401);
    expect(await signInStatus(newEmail)).toBe(200);
  });

  it("Rate limit: a fourth email change within the hour from one client IP is refused with 429 and queues no mail (control: another IP is served)", async () => {
    await signUp("rnx78-limit@renovix.test");
    const cookie = await signIn("rnx78-limit@renovix.test");
    const context = (await auth.$context) as unknown as { rateLimit: { enabled: boolean } };
    const changeEmail = (index: number, clientIp: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/better/change-email",
        payload: { newEmail: `rnx78-limit-new-${index}@renovix.test`, callbackURL: SETTINGS_URL },
        headers: { cookie, origin: CHAT_ORIGIN, "x-rnx78-client-ip": clientIp },
      });
    context.rateLimit.enabled = true; // Better Auth's limiter is off outside production
    try {
      const allowed = [await changeEmail(1, "203.0.113.7"), await changeEmail(2, "203.0.113.7"), await changeEmail(3, "203.0.113.7")];

      const refused = await changeEmail(4, "203.0.113.7");
      const otherIp = await changeEmail(5, "203.0.113.8");

      expect(allowed.map((res) => res.statusCode)).toEqual([200, 200, 200]);
      expect(refused.statusCode).toBe(429);
      // Better Auth's default for this path is 3 per 10 seconds; a wait near one hour proves the custom rule.
      expect(Number(refused.headers["x-retry-after"])).toBeGreaterThan(3500);
      expect(otherIp.statusCode).toBe(200);
      const recipients = (await started.prisma.emailJob.findMany()).map((job) => job.recipientEmail).sort();
      expect(recipients).toEqual([1, 2, 3, 5].map((index) => `rnx78-limit-new-${index}@renovix.test`));
    } finally {
      context.rateLimit.enabled = false;
    }
  });

  it("AC6: a Google-only user sets a password through POST /auth/password, then signs in with email and password; a second one is refused", async () => {
    const email = "rnx78-ac6@renovix.test";
    const cookie = await signUpWithGoogle({ id: "google-ac6", email, name: "AC6" });
    const accounts = await get("/api/auth/better/list-accounts", cookie);
    expect(accounts.json().map((account: { providerId: string }) => account.providerId)).toEqual(["google"]);
    expect(await signInStatus(email)).toBe(401);

    const set = await post("/api/auth/password", { newPassword: PASSWORD }, cookie);

    expect(set.statusCode).toBe(204);
    expect(await signInStatus(email)).toBe(200);
    const again = await post("/api/auth/password", { newPassword: "rnx78-another-made-up-password" }, cookie);
    expect([again.statusCode, again.json().code]).toEqual([400, "PASSWORD_ALREADY_SET"]);
    expect(await signInStatus(email)).toBe(200);
  });

  it("AC6: POST /auth/password refuses an invalid body and a request without a session", async () => {
    const cookie = await signUpWithGoogle({ id: "google-ac6-invalid", email: "rnx78-ac6-invalid@renovix.test", name: "AC6" });

    const tooShort = await post("/api/auth/password", { newPassword: "short" }, cookie);
    const unknownKey = await post("/api/auth/password", { newPassword: PASSWORD, userId: "someone-else" }, cookie);
    const noSession = await post("/api/auth/password", { newPassword: PASSWORD });

    expect([tooShort.statusCode, tooShort.json().error.type]).toEqual([400, "invalid_request_error"]);
    expect(unknownKey.statusCode).toBe(400);
    expect(noSession.statusCode).toBe(401);
    expect(await started.prisma.account.count({ where: { providerId: "credential" } })).toBe(0);
  });

  it("AC7: linking a Google account whose email differs is refused with a reason (control: the same email links)", async () => {
    await signUp("rnx78-ac7@renovix.test");
    const cookie = await signIn("rnx78-ac7@renovix.test");

    const refused = await linkGoogle(cookie, { id: "google-ac7-other", email: "rnx78-someone-else@renovix.test", name: "AC7" });

    expect(refused.statusCode).toBe(302);
    expect(refused.headers.location).toMatch(new RegExp(`^${SETTINGS_URL}\\?error=email_doesn(%27|')t_match`));
    expect(await googleAccounts()).toBe(0);
    const linked = await linkGoogle(cookie, { id: "google-ac7-same", email: "rnx78-ac7@renovix.test", name: "AC7" });
    expect([linked.statusCode, linked.headers.location]).toEqual([302, SETTINGS_URL]);
    expect(await googleAccounts()).toBe(1);
  });

  it("RNX-334: a later Google sign-in does not overwrite an uploaded profile photo (control: sign-up stored the Google picture)", async () => {
    const email = "rnx334-google@renovix.test";
    const googlePicture = "https://lh3.googleusercontent.example.test/a/first-picture";
    await signUpWithGoogle({ id: "google-rnx334", email, name: "RNX-334", image: googlePicture });
    const readAvatar = async () => (await started.prisma.user.findUniqueOrThrow({ where: { email }, select: { avatar: true } })).avatar;
    expect(await readAvatar()).toBe(googlePicture);
    const user = await started.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const uploadedKey = `users/${user.id}/profile-photo/rnx334-uploaded.png`;
    await started.prisma.user.update({ where: { id: user.id }, data: { avatar: uploadedKey } });

    await signUpWithGoogle({ id: "google-rnx334", email, name: "RNX-334", image: "https://lh3.googleusercontent.example.test/a/changed-picture" });

    expect(await readAvatar()).toBe(uploadedKey);
  });
});
