import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { LightMyRequestResponse } from "fastify";
import { AdminUsersModule } from "../../admin-users/admin-users.module";
import { AdminUsersService } from "../../admin-users/service/admin-users.service";
import { ChatController } from "../../chat/controller/chat.controller";
import { ChatService } from "../../chat/service/chat.service";
import { TransactionService } from "../../prisma/transaction.service";
import { AuthModule } from "../auth.module";
import { BetterAuthTestApp, startBetterAuthApp } from "../../../../test/better-auth-app";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { createApiKey } from "../../../../test/factories";

// RNX-100 (D427): a suspended user is refused by the sign-in, the session check and the API-key guard, before any
// handler runs (nothing is charged), and gets in again once reinstated. Real lib/auth and better-auth on the test
// database, behind the real AuthModule, AccessGuard and ApiKeyGuard; suspend and reinstate are AdminUsersService's own
// (the back-office HTTP side is admin-user-actions.spec.ts). POST /chat/completions has a recording ChatService
// double: a refused key never reaches it. Made-up email address, password and key only.
jest.mock("better-auth", () => require("../../../../test/real-better-auth").requireNative("better-auth"));
jest.mock("better-auth/adapters/prisma", () =>
  require("../../../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("../../../lib/auth", () => require("../../../../test/real-better-auth").loadLibAuth());
jest.mock("../../chat/service/chat.service", () => ({ ChatService: class {} }));

const PASSWORD = "rnx100-made-up-password";
const FUNDED_CREDITS = 5;
/** A trusted origin in test (CORS_ORIGIN unset: the local origins); Better Auth checks it on a cookie POST. */
const CHAT_ORIGIN = "http://localhost:3000";

/** The name=value pairs of every cookie a response set: the session token and the cookie cache. */
const cookiesOf = (res: LightMyRequestResponse): string => {
  const header = res.headers["set-cookie"];
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [header];
  return lines.map((line) => line.split(";")[0]).join("; ");
};

describe("RNX-100: a suspended user is refused on every way in (Fastify, test database)", () => {
  const chat = { createCompletion: jest.fn(async () => ({ completion: { id: "rnx100-completion" }, creditsUsed: "1" })), streamCompletion: jest.fn() };
  let started: BetterAuthTestApp;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    started = await startBetterAuthApp({
      imports: [AuthModule, AdminUsersModule],
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chat }],
    });
    app = started.app;
  });

  beforeEach(() => chat.createCompletion.mockClear());

  afterAll(() => app?.close());

  const signIn = (email: string) => app.inject({ method: "POST", url: "/api/auth/better/sign-in/email", payload: { email, password: PASSWORD } });
  /** Signs up a new account (made-up email) and returns its user id. */
  const signUp = async (email: string): Promise<string> => {
    await app.inject({ method: "POST", url: "/api/auth/better/sign-up/email", payload: { email, password: PASSWORD, name: "RNX-100" } });
    return (await started.prisma.user.findUniqueOrThrow({ where: { email } })).id;
  };
  /** GET /auth/me, a session route behind CombinedAuthGuard. */
  const me = (cookie: string) => app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
  /** POST /chat/completions with an API key. */
  const complete = (apiKey: string) =>
    app.inject({ method: "POST", url: "/api/chat/completions", headers: { authorization: `Bearer ${apiKey}` }, payload: { model: "rnx100/m", messages: [{ role: "user", content: "Hi" }] } });
  /** What a charge would change: the paid wallet's balance, the user's ledger entries and the credit reservations. */
  const charges = async (userId: string) => ({
    balance: (await started.prisma.creditAccount.findFirstOrThrow({ where: { userId, wallet: "paid" } })).balance.toString(),
    entries: await started.prisma.creditLedgerEntry.count({ where: { memberUserId: userId } }),
    reservations: await started.prisma.creditReservation.count(),
  });
  const runAsAdmin = (write: (service: AdminUsersService, tx: Parameters<AdminUsersService["suspend"]>[1]) => Promise<unknown>) =>
    started.moduleRef.get(TransactionService).run((tx) => write(started.moduleRef.get(AdminUsersService), tx));

  it("AC6: after the suspension the right password, a session from before it and a valid key are each refused and nothing is charged; once reinstated all three work again", async () => {
    const email = "rnx100-suspended@renovix.test";
    const userId = await signUp(email);
    await fundPaidWallet(started.prisma, userId, FUNDED_CREDITS);
    const apiKey = await createApiKey(started.prisma, userId);
    const sessionBefore = cookiesOf(await signIn(email));
    expect((await me(sessionBefore)).statusCode).toBe(200);
    expect((await complete(apiKey)).statusCode).toBe(200);
    chat.createCompletion.mockClear();
    const chargesBefore = await charges(userId);

    await runAsAdmin((service, tx) => service.suspend(userId, tx));
    const signInWhileSuspended = await signIn(email);
    const sessionWhileSuspended = await me(sessionBefore);
    const keyWhileSuspended = await complete(apiKey);

    expect(signInWhileSuspended.statusCode).toBe(401);
    expect(signInWhileSuspended.json()).toMatchObject({ code: "FAILED_TO_CREATE_SESSION" });
    expect(cookiesOf(signInWhileSuspended)).not.toContain("better-auth.session_token=");
    expect(await started.prisma.session.count({ where: { userId } })).toBe(0);
    expect(sessionWhileSuspended.statusCode).toBe(401);
    expect(keyWhileSuspended.statusCode).toBe(401);
    expect(chat.createCompletion).not.toHaveBeenCalled();
    expect(await charges(userId)).toEqual(chargesBefore);

    await runAsAdmin((service, tx) => service.reinstate(userId, tx));
    const signInAgain = await signIn(email);

    expect(signInAgain.statusCode).toBe(200);
    expect((await me(cookiesOf(signInAgain))).statusCode).toBe(200);
    expect((await complete(apiKey)).statusCode).toBe(200);
    expect(chat.createCompletion).toHaveBeenCalledTimes(1);
  });

  it("the session check reads the status itself: a session that outlived the suspension (a sign-in racing it) is a 401, and works again when active", async () => {
    const email = "rnx100-race@renovix.test";
    const userId = await signUp(email);
    const session = cookiesOf(await signIn(email));
    expect((await me(session)).statusCode).toBe(200);

    await started.prisma.user.update({ where: { id: userId }, data: { status: "suspended" } });
    const whileSuspended = await me(session);
    await started.prisma.user.update({ where: { id: userId }, data: { status: "active" } });
    const afterwards = await me(session);

    expect(await started.prisma.session.count({ where: { userId } })).toBeGreaterThan(0);
    expect(whileSuspended.statusCode).toBe(401);
    expect(afterwards.statusCode).toBe(200);
  });

  it("a suspended user cannot lift the suspension through Better Auth's update-user, even with the cookie-cached session from before it", async () => {
    const email = "rnx100-self-reinstate@renovix.test";
    const userId = await signUp(email);
    const sessionBefore = cookiesOf(await signIn(email));
    const statusOf = async () => (await started.prisma.user.findUniqueOrThrow({ where: { id: userId } })).status;
    const updateUser = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/api/auth/better/update-user", headers: { cookie: sessionBefore, origin: CHAT_ORIGIN }, payload });
    const control = await updateUser({ name: "RNX-100 renamed" });
    const whileActive = await updateUser({ status: "deleted" });
    const statusAfterActiveAttempt = await statusOf();

    await runAsAdmin((service, tx) => service.suspend(userId, tx));
    const whileSuspended = await updateUser({ status: "active" });

    expect(control.statusCode).toBe(200);
    expect(whileActive.statusCode).not.toBe(200);
    expect(statusAfterActiveAttempt).toBe("active");
    expect(whileSuspended.statusCode).not.toBe(200);
    expect(await statusOf()).toBe("suspended");
  });

  it("a sign-up cannot choose its own status: the account is active whatever the body says", async () => {
    const email = "rnx100-signup-status@renovix.test";

    const res = await app.inject({ method: "POST", url: "/api/auth/better/sign-up/email", payload: { email, password: PASSWORD, name: "RNX-100", status: "deleted" } });

    const stored = await started.prisma.user.findUnique({ where: { email } });
    expect(stored === null ? res.statusCode : stored.status).not.toBe("deleted");
    expect(stored?.status ?? "active").toBe("active");
  });
});
