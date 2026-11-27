import { randomUUID } from "node:crypto";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminUsersModule } from "../admin-users.module";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";
import { createApiKey, createUser } from "../../../../test/factories";

// RNX-100: suspend, reinstate, the API key reset and the user's sessions (list, revoke one, revoke all) through real
// HTTP (Fastify `inject`), the real AccessGuard, audit hook and PrismaService on the test database. Made-up values only.

const ACCESS = "rx_admin_access";
const MINUTE = 60_000;
const REASON = "ticket 6100: account abuse report";
const AUDITED_RESOURCES = ["user", "user_api_key", "user_session"];
/** Made-up session secrets: none of them may appear in a sessions response (AC5). */
const SESSION_TOKEN = "made-up-session-token-rnx100-7f3a";
const SESSION_IP = "198.51.100.42";
const SESSION_AGENT = "MadeUpBrowser/2.0 (rnx100)";
const SESSION_KEYS = ["createdAt", "expiresAt", "id", "userAgent"];

type Json = Record<string, any>;
type Method = "GET" | "POST" | "DELETE";
/** A route of this ticket: method and URL for a user (and a session id where the path has one). */
type RouteOf = (userId: string, sessionId: string) => { readonly method: Method; readonly url: string };

const WRITE_ROUTES: readonly (readonly [string, RouteOf])[] = [
  ["suspend", (userId) => ({ method: "POST", url: `/admin/users/${userId}/suspend` })],
  ["reinstate", (userId) => ({ method: "POST", url: `/admin/users/${userId}/reinstate` })],
  ["reset API keys", (userId) => ({ method: "POST", url: `/admin/users/${userId}/reset-api-keys` })],
  ["revoke one session", (userId, sessionId) => ({ method: "DELETE", url: `/admin/users/${userId}/sessions/${sessionId}` })],
  ["revoke all sessions", (userId) => ({ method: "DELETE", url: `/admin/users/${userId}/sessions` })],
];
const LIST_SESSIONS: RouteOf = (userId) => ({ method: "GET", url: `/admin/users/${userId}/sessions` });

describe("Back-office user actions (RNX-100, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule, AdminUsersModule] }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  /** An admin of this role (built-in, or a custom role with exactly `permissions`) with a full session; id and cookie. */
  const signedIn = async (role: string, permissions?: string[]) => {
    if (permissions) await prisma.adminRole.create({ data: { name: role, builtIn: false, permissions } });
    const admin = await createAdmin(prisma, moduleRef, { email: `${role}-${randomUUID().slice(0, 6)}@example.com`, role });
    const session = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  const send = (cookie: string, { method, url }: { method: Method; url: string }, payload?: Json) =>
    app.inject({ method, url, headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload: method === "GET" ? undefined : payload });
  const suspend = (cookie: string, userId: string, reason = REASON) => send(cookie, WRITE_ROUTES[0][1](userId, ""), { reason });
  const reinstate = (cookie: string, userId: string, reason = REASON) => send(cookie, WRITE_ROUTES[1][1](userId, ""), { reason });
  /** A session of this user, created `ageMinutes` ago and valid for an hour. */
  const createSession = (userId: string, ageMinutes = 0, token = `token-${randomUUID()}`) =>
    prisma.session.create({
      data: { userId, token, ipAddress: SESSION_IP, userAgent: SESSION_AGENT, createdAt: new Date(Date.now() - ageMinutes * MINUTE), expiresAt: new Date(Date.now() + 60 * MINUTE) },
    });
  const auditRows = () => prisma.adminAuditLog.findMany({ where: { resource: { in: AUDITED_RESOURCES } } });
  /** Everything a refused write must leave as it was: statuses, sessions, keys and the audit rows of these resources. */
  const snapshot = async () => ({
    users: await prisma.user.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } }),
    sessions: await prisma.session.findMany({ select: { id: true, userId: true }, orderBy: { id: "asc" } }),
    keys: await prisma.apiKey.findMany({ select: { id: true, revokedAt: true }, orderBy: { id: "asc" } }),
    audit: await auditRows(),
  });
  /** A user with two sessions, two active keys and one revoked key; another user with one session and one key. */
  const seedTarget = async (status = "active") => {
    const user = await createUser(prisma, { status });
    const sessions = [await createSession(user.id, 2), await createSession(user.id, 1)];
    await createApiKey(prisma, user.id);
    await createApiKey(prisma, user.id);
    await createApiKey(prisma, user.id, { revokedAt: new Date("2026-11-01T08:00:00Z") });
    const other = await createUser(prisma);
    await createSession(other.id);
    await createApiKey(prisma, other.id);
    return { user, sessions, other };
  };

  describe("AC1: suspend", () => {
    it("an active user with two sessions: status suspended, both sessions gone, exactly one audit row with the admin, the user and the reason", async () => {
      const { user, other } = await seedTarget();
      const { adminId, cookie } = await signedIn("operations");

      const res = await suspend(cookie, user.id, `  ${REASON}  `);

      expect(res.statusCode).toBe(204);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("suspended");
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1);
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        adminId, resource: "user", action: "suspend", reason: REASON,
        before: { userId: user.id, status: "active" }, after: { userId: user.id, status: "suspended", sessionsEnded: 2 },
      });
    });

    it("two suspensions at once: one 204 and one 409, one audit row (the status change is one conditional UPDATE)", async () => {
      const { user } = await seedTarget();
      const { cookie } = await signedIn("operations");

      const responses = await Promise.all([suspend(cookie, user.id), suspend(cookie, user.id)]);

      expect(responses.map((res) => res.statusCode).sort()).toEqual([204, 409]);
      expect(await auditRows()).toHaveLength(1);
    });

    it("an already suspended user: 409 and nothing changes, no audit row", async () => {
      const { user } = await seedTarget("suspended");
      const { cookie } = await signedIn("operations");
      const before = await snapshot();

      const res = await suspend(cookie, user.id);

      expect(res.statusCode).toBe(409);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("AC3: reinstate", () => {
    it("a suspended user: status active, one audit row; sessions and keys are not restored; a second reinstate is a 409", async () => {
      const { user } = await seedTarget();
      const { adminId, cookie } = await signedIn("operations");
      await suspend(cookie, user.id);
      const keysAfterSuspend = await prisma.apiKey.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });

      const first = await reinstate(cookie, user.id);
      const afterFirst = await snapshot();
      const second = await reinstate(cookie, user.id);

      expect(first.statusCode).toBe(204);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("active");
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.apiKey.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } })).toEqual(keysAfterSuspend);
      const reinstated = (await auditRows()).filter((row) => row.action === "reinstate");
      expect(reinstated).toHaveLength(1);
      expect(reinstated[0]).toMatchObject({ adminId, resource: "user", reason: REASON, before: { userId: user.id, status: "suspended" }, after: { userId: user.id, status: "active" } });
      expect(second.statusCode).toBe(409);
      expect(await snapshot()).toEqual(afterFirst);
    });
  });

  describe("AC4: reset API keys", () => {
    it("two active keys and one revoked: both active get revokedAt, the revoked one keeps its time, the answer is 2, one audit row", async () => {
      const { user, other } = await seedTarget();
      const { adminId, cookie } = await signedIn("operations");
      const revokedBefore = await prisma.apiKey.findFirstOrThrow({ where: { userId: user.id, revokedAt: { not: null } } });

      const res = await send(cookie, WRITE_ROUTES[2][1](user.id, ""), { reason: REASON });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ revoked: 2 });
      const keys = await prisma.apiKey.findMany({ where: { userId: user.id } });
      expect(keys.filter((key) => key.id !== revokedBefore.id).map((key) => key.revokedAt instanceof Date)).toEqual([true, true]);
      expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: revokedBefore.id } })).revokedAt).toEqual(new Date("2026-11-01T08:00:00Z"));
      expect((await prisma.apiKey.findFirstOrThrow({ where: { userId: other.id } })).revokedAt).toBeNull();
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ adminId, resource: "user_api_key", action: "reset", reason: REASON, before: { userId: user.id, unrevokedKeys: 2 }, after: { userId: user.id, unrevokedKeys: 0 } });
    });
  });

  describe("AC5: the sessions", () => {
    it("the list answers id, created, expires and user agent only, newest first: no token or IP value or key in the body", async () => {
      const user = await createUser(prisma);
      const older = await createSession(user.id, 10, SESSION_TOKEN);
      const newer = await createSession(user.id, 1);
      const { cookie } = await signedIn("support");

      const res = await send(cookie, LIST_SESSIONS(user.id, ""));

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Object.keys(body)).toEqual(["sessions"]);
      expect(body.sessions.map((session: Json) => session.id)).toEqual([newer.id, older.id]);
      expect(body.sessions.every((session: Json) => JSON.stringify(Object.keys(session).sort()) === JSON.stringify(SESSION_KEYS))).toBe(true);
      expect(body.sessions[1]).toEqual({ id: older.id, createdAt: older.createdAt.toISOString(), expiresAt: older.expiresAt.toISOString(), userAgent: SESSION_AGENT });
      for (const value of [SESSION_TOKEN, newer.token, SESSION_IP, "token", "ipAddress", "ip_address"]) expect(res.body).not.toContain(value);
    });

    it("the list is capped at the 50 newest sessions", async () => {
      const user = await createUser(prisma);
      const now = Date.now();
      await prisma.session.createMany({
        data: Array.from({ length: 52 }, (_, i) => ({ userId: user.id, token: `cap-${i}-${randomUUID()}`, createdAt: new Date(now - i * MINUTE), expiresAt: new Date(now + 60 * MINUTE) })),
      });
      const { cookie } = await signedIn("support");

      const sessions = (await send(cookie, LIST_SESSIONS(user.id, ""))).json().sessions;

      expect(sessions).toHaveLength(50);
      expect(sessions[0].createdAt).toBe(new Date(now).toISOString());
    });

    it("revoking one session leaves the user's others (and other users') as they are; one audit row", async () => {
      const { user, sessions, other } = await seedTarget();
      const { adminId, cookie } = await signedIn("operations");

      const res = await send(cookie, WRITE_ROUTES[3][1](user.id, sessions[0].id), { reason: REASON });

      expect(res.statusCode).toBe(204);
      expect((await prisma.session.findMany({ where: { userId: user.id } })).map((session) => session.id)).toEqual([sessions[1].id]);
      expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1);
      const rows = await auditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ adminId, resource: "user_session", action: "revoke", reason: REASON, after: { userId: user.id, sessionId: sessions[0].id, revoked: true } });
    });

    it("a session id of another user under this user's path: 404, nothing changes, no audit row", async () => {
      const { user, other } = await seedTarget();
      const otherSession = await prisma.session.findFirstOrThrow({ where: { userId: other.id } });
      const { cookie } = await signedIn("operations");
      const before = await snapshot();

      const res = await send(cookie, WRITE_ROUTES[3][1](user.id, otherSession.id), { reason: REASON });

      expect(res.statusCode).toBe(404);
      expect(await snapshot()).toEqual(before);
    });

    it("revoke all ends every session of the user and answers how many; on a user with none it answers 0 and is still audited", async () => {
      const { user, other } = await seedTarget();
      const { cookie } = await signedIn("operations");

      const all = await send(cookie, WRITE_ROUTES[4][1](user.id, ""), { reason: REASON });
      const none = await send(cookie, WRITE_ROUTES[4][1](user.id, ""), { reason: REASON });

      expect([all.statusCode, all.json()]).toEqual([200, { revoked: 2 }]);
      expect([none.statusCode, none.json()]).toEqual([200, { revoked: 0 }]);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1);
      expect((await auditRows()).map((row) => [row.action, row.after])).toEqual([
        ["revoke_all", { userId: user.id, sessions: 0 }],
        ["revoke_all", { userId: user.id, sessions: 0 }],
      ]);
    });
  });

  describe("AC2: refused writes change nothing and write no audit row", () => {
    it.each(WRITE_ROUTES)("%s: a role without users:write gets 403", async (name, route) => {
      const { user, sessions } = await seedTarget(name === "reinstate" ? "suspended" : "active");
      const { cookie } = await signedIn("users-reader", ["users:read", "users:read_pii", "credits:read"]);
      const before = await snapshot();

      const res = await send(cookie, route(user.id, sessions[0].id), { reason: REASON });

      expect(res.statusCode).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it.each(WRITE_ROUTES.flatMap(([name, route]) => [
      [name, "an empty reason", route, { reason: "" }],
      [name, "a blank reason", route, { reason: "  \t " }],
      [name, "no reason", route, {}],
      [name, "a reason of 501 characters", route, { reason: "x".repeat(501) }],
    ] as const))("%s with %s: 400", async (name, _case, route, payload) => {
      const { user, sessions } = await seedTarget(name === "reinstate" ? "suspended" : "active");
      const { cookie } = await signedIn("operations");
      const before = await snapshot();

      const res = await send(cookie, route(user.id, sessions[0].id), payload);

      expect(res.statusCode).toBe(400);
      expect(await snapshot()).toEqual(before);
    });

    it.each([...WRITE_ROUTES, ["list sessions", LIST_SESSIONS] as const])("%s: a deleted or unknown user is a 404, nothing changes", async (name, route) => {
      const { user, sessions } = await seedTarget("deleted");
      const { cookie } = await signedIn("operations");
      const before = await snapshot();

      const deleted = await send(cookie, route(user.id, sessions[0].id), { reason: REASON });
      const unknown = await send(cookie, route(randomUUID(), sessions[0].id), { reason: REASON });

      expect([name, deleted.statusCode, unknown.statusCode]).toEqual([name, 404, 404]);
      expect(await snapshot()).toEqual(before);
    });

    it("control: a custom role with users:write only may suspend", async () => {
      const { user } = await seedTarget();
      const { cookie } = await signedIn("users-writer", ["users:write"]);

      expect((await suspend(cookie, user.id)).statusCode).toBe(204);
    });
  });
});
