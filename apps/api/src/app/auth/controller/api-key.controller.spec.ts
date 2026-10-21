import { Controller, Get, Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { Access } from "../../../common/decorators/access.decorator";
import { AuthModule } from "../auth.module";
import { ApiKeyRepository } from "../repository/api-key.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createApiKey, createUser } from "../../../../test/factories";

// better-auth is ESM-only; BetterAuthController and the guards import it.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

/** A route that only an API key opens, to see a key answer 200 or 401 over HTTP. */
@Controller("api-key-probe")
class ApiKeyProbeController {
  @Get()
  @Access({ auth: ["apiKey"] })
  probe(): { ok: true } {
    return { ok: true };
  }
}

const KEY_SHAPE = /^rnx_live_[0-9a-f]{76}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "correct-horse-battery";

describe("API keys (RNX-18, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
      controllers: [ApiKeyProbeController],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  const signedIn = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET as string)}`,
  });
  const probe = (apiKey: string) =>
    app.inject({ method: "GET", url: "/api-key-probe", headers: { authorization: `Bearer ${apiKey}` } });
  const createKey = (user: { id: string; email: string }, payload: object) =>
    app.inject({ method: "POST", url: "/auth/keys", headers: signedIn(user), payload });
  const listKeys = (user: { id: string; email: string }) =>
    app.inject({ method: "GET", url: "/auth/keys", headers: signedIn(user) });
  const revokeKey = (user: { id: string; email: string }, id: string) =>
    app.inject({ method: "DELETE", url: `/auth/keys/${id}`, headers: signedIn(user) });
  const regenerate = (user: { id: string; email: string }) =>
    app.inject({ method: "POST", url: "/auth/keys/regenerate", headers: signedIn(user) });

  describe("AC1: no plaintext key is stored", () => {
    it("after the migrations, users has no apiKey column", async () => {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`;

      expect(columns.map((c) => c.column_name)).not.toContain("apiKey");
      expect(columns.length).toBeGreaterThan(0);
    });

    it("a created key is stored only as its prefix and hash: neither the key nor its secret part is in any row", async () => {
      const user = await createUser(prisma);

      const res = await createKey(user, { name: "ci", expiresIn: "never" });

      const { apiKey, prefix } = res.json();
      const secretPart = apiKey.slice("rnx_live_".length + prefix.length);
      const [{ keys, users }] = await prisma.$queryRaw<{ keys: string; users: string }[]>`
        SELECT (SELECT json_agg(k)::text FROM api_keys k) AS keys, (SELECT json_agg(u)::text FROM users u) AS users`;
      expect(res.statusCode).toBe(201);
      expect(keys).toContain(prefix);
      expect(`${keys}${users}`).not.toContain(apiKey);
      expect(`${keys}${users}`).not.toContain(secretPart);
    });
  });

  describe("POST /auth/keys", () => {
    it("creates a key with the chosen name and expiry and answers the plaintext once", async () => {
      const user = await createUser(prisma);
      const before = Date.now();

      const res = await createKey(user, { name: "  deploy bot  ", expiresIn: "30d" });

      const body = res.json();
      expect(res.statusCode).toBe(201);
      expect(body.apiKey).toMatch(KEY_SHAPE);
      expect(body).toMatchObject({ name: "deploy bot", prefix: body.apiKey.slice(9, 21), lastUsedAt: null, revokedAt: null });
      expect(body).not.toHaveProperty("keyHash");
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
      expect(new Date(body.expiresAt).getTime()).toBeLessThan(before + 31 * DAY_MS);
      expect((await probe(body.apiKey)).statusCode).toBe(200);
    });

    it("a key that never expires has no expiry; a user may hold several keys", async () => {
      const user = await createUser(prisma);

      const first = await createKey(user, { name: "one", expiresIn: "never" });
      const second = await createKey(user, { name: "two", expiresIn: "1y" });

      expect(first.json().expiresAt).toBeNull();
      expect(second.json().apiKey).not.toBe(first.json().apiKey);
      expect((await probe(first.json().apiKey)).statusCode).toBe(200);
      expect((await probe(second.json().apiKey)).statusCode).toBe(200);
    });

    it.each([
      ["no name", { expiresIn: "never" }],
      ["an empty name", { name: "   ", expiresIn: "never" }],
      ["an unknown expiry", { name: "x", expiresIn: "7d" }],
      ["an unknown field", { name: "x", expiresIn: "never", tier: "pro" }],
    ])("refuses %s with 400 and stores nothing", async (_case, payload) => {
      const user = await createUser(prisma);

      const res = await createKey(user, payload);

      expect(res.statusCode).toBe(400);
      expect(await prisma.apiKey.count()).toBe(0);
    });

    it("refuses a caller without a login token or session (401) and one with an API key (403)", async () => {
      const user = await createUser(prisma);
      const apiKey = await createApiKey(prisma, user.id);

      const anonymous = await app.inject({ method: "POST", url: "/auth/keys", payload: { name: "x", expiresIn: "never" } });
      const withKey = await app.inject({
        method: "POST",
        url: "/auth/keys",
        headers: { authorization: `Bearer ${apiKey}` },
        payload: { name: "x", expiresIn: "never" },
      });

      expect([anonymous.statusCode, withKey.statusCode]).toEqual([401, 403]);
      expect(await prisma.apiKey.count()).toBe(1);
    });
  });

  describe("GET /auth/keys", () => {
    it("lists the user's own keys, newest first, with their state and without hash or plaintext", async () => {
      const user = await createUser(prisma);
      const other = await createUser(prisma);
      const older = await createKey(user, { name: "older", expiresIn: "90d" });
      const newer = await createKey(user, { name: "newer", expiresIn: "never" });
      await createKey(other, { name: "not mine", expiresIn: "never" });
      await probe(newer.json().apiKey);

      const res = await listKeys(user);

      const keys = res.json();
      expect(res.statusCode).toBe(200);
      expect(keys.map((k: { name: string }) => k.name)).toEqual(["newer", "older"]);
      expect(Object.keys(keys[0]).sort()).toEqual(["createdAt", "expiresAt", "id", "lastUsedAt", "name", "prefix", "revokedAt"]);
      expect(keys[0].lastUsedAt).not.toBeNull();
      expect(keys[1]).toMatchObject({ id: older.json().id, lastUsedAt: null, revokedAt: null });
      expect(JSON.stringify(keys)).not.toContain(newer.json().apiKey);
    });
  });

  describe("DELETE /auth/keys/:id", () => {
    it("AC2: a revoked key answers 401 at once; the user's other key still answers 200 (control)", async () => {
      const user = await createUser(prisma);
      const revoked = await createKey(user, { name: "revoked", expiresIn: "never" });
      const kept = await createKey(user, { name: "kept", expiresIn: "never" });

      const res = await revokeKey(user, revoked.json().id);

      expect(res.statusCode).toBe(204);
      expect((await probe(revoked.json().apiKey)).statusCode).toBe(401);
      expect((await probe(kept.json().apiKey)).statusCode).toBe(200);
      expect((await listKeys(user)).json().find((k: { id: string }) => k.id === revoked.json().id).revokedAt).not.toBeNull();
    });

    it("another user's key is a 404 and that key keeps working", async () => {
      const owner = await createUser(prisma);
      const intruder = await createUser(prisma);
      const key = await createKey(owner, { name: "owner's", expiresIn: "never" });

      const res = await revokeKey(intruder, key.json().id);

      expect(res.statusCode).toBe(404);
      expect((await probe(key.json().apiKey)).statusCode).toBe(200);
    });

    it("an unknown id is a 404", async () => {
      const user = await createUser(prisma);

      const res = await revokeKey(user, "00000000-0000-0000-0000-000000000000");

      expect(res.statusCode).toBe(404);
    });

    it("revoking a revoked key again answers 204 and keeps the first revocation time", async () => {
      const user = await createUser(prisma);
      const key = await createKey(user, { name: "twice", expiresIn: "never" });
      await revokeKey(user, key.json().id);
      const first = (await prisma.apiKey.findFirstOrThrow()).revokedAt;

      const res = await revokeKey(user, key.json().id);

      expect(res.statusCode).toBe(204);
      expect((await prisma.apiKey.findFirstOrThrow()).revokedAt).toEqual(first);
    });
  });

  describe("expiry and wrong keys over HTTP", () => {
    it("AC3: a key past its expiry answers 401", async () => {
      const user = await createUser(prisma);
      const apiKey = await createApiKey(prisma, user.id, { expiresAt: new Date(Date.now() - 1000) });

      expect((await probe(apiKey)).statusCode).toBe(401);
    });

    it("AC4: a wrong key with a valid prefix answers 401", async () => {
      const user = await createUser(prisma);
      const apiKey = await createApiKey(prisma, user.id);
      const wrong = `${apiKey.slice(0, 21)}${"0".repeat(64)}`;

      expect((await probe(wrong)).statusCode).toBe(401);
      expect((await probe(apiKey)).statusCode).toBe(200);
    });
  });

  describe("AC6: sign-up creates no key", () => {
    it("register answers no key and stores none; GET /auth/me has no apiKey", async () => {
      const registered = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: "no-key@test.local", password: PASSWORD },
      });
      const me = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: `Bearer ${registered.json().token}` },
      });

      expect([registered.statusCode, me.statusCode]).toEqual([201, 200]);
      expect(registered.json().user).not.toHaveProperty("apiKey");
      expect(registered.json()).not.toHaveProperty("apiKeyWarning");
      expect(registered.body).not.toContain("rnx_live_");
      expect(me.json()).not.toHaveProperty("apiKey");
      expect(await prisma.apiKey.count()).toBe(0);
    });
  });

  describe("POST /auth/keys/regenerate (compatibility route until RX-82)", () => {
    it("AC6: answers a new key once in the shape the profile page reads; the old keys answer 401, the new one 200", async () => {
      const user = await createUser(prisma);
      const oldA = await createApiKey(prisma, user.id);
      const oldB = await createApiKey(prisma, user.id);

      const res = await regenerate(user);

      const body = res.json();
      expect(res.statusCode).toBe(200);
      expect(Object.keys(body).sort()).toEqual(["apiKey", "apiKeyWarning"]);
      expect(body.apiKey).toMatch(KEY_SHAPE);
      expect([(await probe(oldA)).statusCode, (await probe(oldB)).statusCode]).toEqual([401, 401]);
      expect((await probe(body.apiKey)).statusCode).toBe(200);
      const keys = (await listKeys(user)).json();
      expect(keys.filter((k: { revokedAt: string | null }) => k.revokedAt === null)).toEqual([
        expect.objectContaining({ prefix: body.apiKey.slice(9, 21), expiresAt: null }),
      ]);
    });

    it("does not touch another user's keys", async () => {
      const user = await createUser(prisma);
      const other = await createUser(prisma);
      const othersKey = await createApiKey(prisma, other.id);

      await regenerate(user);

      expect((await probe(othersKey)).statusCode).toBe(200);
    });

    it("AC8: create and revoke are one transaction: a failed revoke leaves no new key and the old key working", async () => {
      const user = await createUser(prisma);
      const oldKey = await createApiKey(prisma, user.id);
      jest.spyOn(moduleRef.get(ApiKeyRepository), "revokeOtherKeys").mockRejectedValueOnce(new Error("planted revoke failure"));
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      const res = await regenerate(user);

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("rnx_live_");
      expect(await prisma.apiKey.count()).toBe(1);
      expect((await probe(oldKey)).statusCode).toBe(200);
    });
  });
});
