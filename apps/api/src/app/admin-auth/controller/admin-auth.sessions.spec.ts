import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHash } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../admin-auth.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  accessCookie,
  ADMIN_PASSWORD,
  adminHttp,
  advance,
  BackOfficeProbeController,
  createAdmin,
  MINUTE,
  refreshCookie,
  totpCode,
  useFakeDate,
} from "../../../../test/admin-auth";

// RX-94 sessions through real HTTP on the test database: refresh rotation and reuse (criterion 3), the
// idle (30 min) and absolute (12 h) limits on refresh and on every request, and the start-up keys.

/** Starts the module with these environment values set, and restores them afterwards. */
async function startWith(env: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.entries(env).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
  try {
    const { moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule], controllers: [BackOfficeProbeController] });
    const app = await createFastifyApp(moduleRef);
    return { moduleRef, prisma, app, http: adminHttp(app) };
  } finally {
    Object.entries(saved).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
  }
}

describe("Back-office sessions (RX-94, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof adminHttp>;

  beforeAll(async () => {
    ({ moduleRef, prisma, app, http } = await startWith({}));
  });

  beforeEach(async () => {
    useFakeDate();
    await resetDatabase(prisma);
  });

  afterEach(() => jest.useRealTimers());

  afterAll(() => app?.close());

  const signInFull = async () => {
    const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
    const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
    expect(res.statusCode).toBe(200);
    return { admin, res };
  };
  const session = () => prisma.adminSession.findFirstOrThrow();

  describe("criterion 3: a reused refresh token ends the whole session", () => {
    it("refresh rotates; the old token again → 401 and the session revoked; the new token and the new access token stop working too", async () => {
      const { res: signIn } = await signInFull();
      const firstRefresh = refreshCookie(signIn);
      advance(MINUTE);

      const rotated = await http.refresh(firstRefresh);
      const secondRefresh = refreshCookie(rotated);
      const secondAccess = accessCookie(rotated);
      const beforeReuse = await http.call("GET", "/admin/probe", { cookie: secondAccess });
      const reuse = await http.refresh(firstRefresh);
      const withNewRefresh = await http.refresh(secondRefresh);
      const withNewAccess = await http.call("GET", "/admin/probe", { cookie: secondAccess });

      expect(rotated.statusCode).toBe(200);
      expect(rotated.json()).toEqual({ scope: "full" });
      expect(secondRefresh).not.toBe(firstRefresh);
      expect(beforeReuse.statusCode).toBe(200);
      expect(reuse.statusCode).toBe(401);
      expect((await session()).revokedAt).not.toBeNull();
      expect(withNewRefresh.statusCode).toBe(401);
      expect(withNewAccess.statusCode).toBe(401);
    });

    it("L4: after 105 rotations only the latest 100 used hashes are kept; reusing the latest old token still ends the session", async () => {
      const { res: signIn } = await signInFull();
      const tokens = [refreshCookie(signIn)];
      for (let i = 0; i < 105; i++) {
        advance(1_000);
        const res = await http.refresh(tokens[tokens.length - 1]);
        expect(res.statusCode).toBe(200);
        tokens.push(refreshCookie(res));
      }
      const hash = (cookie: string) => createHash("sha256").update(cookie.split("=")[1]).digest("hex");
      const { usedRefreshTokenHashes, lastSeenAt } = await session();

      const reuse = await http.refresh(tokens[tokens.length - 2]);

      expect(lastSeenAt.getTime()).toBe(Date.now());
      expect(usedRefreshTokenHashes).toHaveLength(100);
      expect(usedRefreshTokenHashes).toEqual(tokens.slice(5, 105).map(hash));
      expect(reuse.statusCode).toBe(401);
      expect((await session()).revokedAt).not.toBeNull();
    });

    it("two refreshes at once with the same token: at most one succeeds, and the session ends", async () => {
      const { res: signIn } = await signInFull();
      const token = refreshCookie(signIn);

      const results = await Promise.all([http.refresh(token), http.refresh(token)]);

      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 401]);
      expect((await session()).revokedAt).not.toBeNull();
    });

    it("a made-up token for a live session id: 401, and the session is not ended", async () => {
      const { res: signIn } = await signInFull();
      const sessionId = refreshCookie(signIn).split("=")[1].split(".")[0];

      const res = await http.refresh(`rx_admin_refresh=${sessionId}.${"A".repeat(43)}`);

      expect(res.statusCode).toBe(401);
      expect((await session()).revokedAt).toBeNull();
      expect((await http.refresh(refreshCookie(signIn))).statusCode).toBe(200);
    });

    it.each([
      ["no cookie", undefined],
      ["an unknown token", "rx_admin_refresh=00000000-0000-4000-8000-000000000000.abc"],
      ["the access token in the refresh cookie", "access"],
    ])("%s: 401", async (_case, cookie) => {
      const { res: signIn } = await signInFull();
      const header = cookie === "access" ? `rx_admin_refresh=${accessCookie(signIn).split("=")[1]}` : cookie;

      expect((await http.refresh(header)).statusCode).toBe(401);
    });
  });

  describe("idle (30 min) and absolute (12 h) limits on refresh", () => {
    it("refresh after 29 minutes idle works; after 31 minutes it is refused and the session is revoked", async () => {
      const { res: signIn } = await signInFull();
      advance(29 * MINUTE);
      const fresh = await http.refresh(refreshCookie(signIn));
      advance(31 * MINUTE);

      const stale = await http.refresh(refreshCookie(fresh));

      expect(fresh.statusCode).toBe(200);
      expect(stale.statusCode).toBe(401);
      expect((await session()).revokedAt).not.toBeNull();
    });

    it("kept active by refreshing every 25 minutes, the session still ends 12 hours after sign-in", async () => {
      const { res: signIn } = await signInFull();
      const start = Date.now();
      let refresh = refreshCookie(signIn);
      while (Date.now() + 25 * MINUTE < start + 12 * 60 * MINUTE) {
        advance(25 * MINUTE);
        const res = await http.refresh(refresh);
        expect(res.statusCode).toBe(200);
        refresh = refreshCookie(res);
      }
      jest.setSystemTime(start + 12 * 60 * MINUTE + MINUTE);

      const res = await http.refresh(refresh);

      expect(res.statusCode).toBe(401);
      expect((await session()).revokedAt).not.toBeNull();
    });
  });

  describe("idle and absolute limits on every request (access token valid longer than the limits)", () => {
    let longLived: Awaited<ReturnType<typeof startWith>>;

    beforeAll(async () => {
      longLived = await startWith({ ADMIN_AUTH_ACCESS_TOKEN_SECONDS: String(14 * 3600) });
    });

    afterAll(() => longLived?.app.close());

    const signInLongLived = async () => {
      const admin = await createAdmin(longLived.prisma, longLived.moduleRef, { email: "ops@example.com", enrolled: true });
      return accessCookie(await longLived.http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) }));
    };

    it("29 minutes idle: 200; 31 minutes idle: 401", async () => {
      const cookie = await signInLongLived();
      advance(29 * MINUTE);
      const fresh = await longLived.http.call("GET", "/admin/probe", { cookie });
      advance(31 * MINUTE);

      const stale = await longLived.http.call("GET", "/admin/probe", { cookie });

      expect(fresh.statusCode).toBe(200);
      expect(stale.statusCode).toBe(401);
    });

    it("active every 25 minutes: 200 until 12 hours, 401 after", async () => {
      const cookie = await signInLongLived();
      const start = Date.now();
      while (Date.now() + 25 * MINUTE < start + 12 * 60 * MINUTE) {
        advance(25 * MINUTE);
        expect((await longLived.http.call("GET", "/admin/probe", { cookie })).statusCode).toBe(200);
      }
      jest.setSystemTime(start + 12 * 60 * MINUTE + MINUTE);

      expect((await longLived.http.call("GET", "/admin/probe", { cookie })).statusCode).toBe(401);
    });
  });

  describe("start-up: the keys have no fallback", () => {
    it.each([
      [{ ADMIN_TOTP_ENCRYPTION_KEY: undefined }, "ADMIN_TOTP_ENCRYPTION_KEY"],
      [{ ADMIN_TOTP_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString("base64") }, "ADMIN_TOTP_ENCRYPTION_KEY must be 32 bytes"],
      [{ ADMIN_JWT_SECRET: undefined }, "ADMIN_JWT_SECRET"],
      [{ ADMIN_JWT_SECRET: "short-fake-secret" }, "ADMIN_JWT_SECRET must have at least 32 characters"],
      [
        { ADMIN_JWT_SECRET: "the-same-fake-secret-for-both-of-them", JWT_SECRET: "the-same-fake-secret-for-both-of-them" },
        "ADMIN_JWT_SECRET must not be the same as JWT_SECRET",
      ],
    ])("%o: the module refuses to start", async (env, message) => {
      await expect(startWith(env)).rejects.toThrow(message);
    });
  });
});
