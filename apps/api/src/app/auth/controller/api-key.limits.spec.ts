import { Controller, Get } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import * as jwt from "jsonwebtoken";
import { Access } from "../../../common/decorators/access.decorator";
import { AuthModule } from "../auth.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createApiKey, createUser } from "../../../../test/factories";

// better-auth is ESM-only; BetterAuthController and the guards import it.
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

/** A route that only an API key opens, to count a key's requests over HTTP. */
@Controller("api-key-limits-probe")
class ApiKeyLimitsProbeController {
  @Get()
  @Access({ auth: ["apiKey"] })
  probe(): { ok: true } {
    return { ok: true };
  }
}

const SNAPSHOT_PRICE = { priceUsdCents: 1, exchangeRate: 1, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 1 };
const RATE_LIMIT = 60;

// RNX-232 (18b, D47, D111): a key's allowed tiers are set at creation from the user's newest package, its monthly cap
// is optional, the list shows both, regenerate gives the defaults, and each key has its own requests-per-minute limit.
// Real AuthModule and AccessGuard on the test database, over Fastify.
describe("RNX-232: per-key tiers, cap and rate limit on the key routes (Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
      controllers: [ApiKeyLimitsProbeController],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const signedIn = (user: { id: string; email: string }) => ({
    authorization: `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET as string)}`,
  });
  const createKey = (user: { id: string; email: string }, payload: object) =>
    app.inject({ method: "POST", url: "/auth/keys", headers: signedIn(user), payload: { name: "k", expiresIn: "never", ...payload } });
  const probe = (apiKey: string) =>
    app.inject({ method: "GET", url: "/api-key-limits-probe", headers: { authorization: `Bearer ${apiKey}` } });

  /** A package purchase of this user whose version allows `allowedTiers`, at `createdAt`. */
  const buyPackage = async (buyerUserId: string, allowedTiers: string[], createdAt = new Date()) => {
    const version = { versionNumber: 1, createdBy: "test", reason: "test" };
    const pkg = await prisma.package.create({ data: { name: `P-${createdAt.getTime()}`, displayOrder: 1, active: true, visible: true } });
    const packageVersion = await prisma.packageVersion.create({
      data: { ...version, packageId: pkg.id, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: true, allowedChannels: [], allowedTiers },
    });
    await prisma.purchaseSnapshot.create({
      data: { buyerUserId, packageVersionId: packageVersion.id, ...SNAPSHOT_PRICE, creditsGranted: 1, allowedTiers, createdAt },
    });
  };

  describe("AC2: the tiers a key may call are tiers the user's package allows", () => {
    it("negative: a package without Premium refuses a key with Premium in its list (403), and no key is stored", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard", "advanced"]);

      const actual = await createKey(user, { allowedTiers: ["standard", "premium"] });

      expect(actual.statusCode).toBe(403);
      expect(actual.json().message).toBe("Your package does not allow the tier(s): premium");
      expect(await prisma.apiKey.count()).toBe(0);
    });

    it("control: a list inside the package is stored and answered; without a list the key gets every package tier", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard", "advanced"]);

      const limited = await createKey(user, { allowedTiers: ["standard"] });
      const defaulted = await createKey(user, {});

      expect([limited.statusCode, limited.json().allowedTiers]).toEqual([201, ["standard"]]);
      expect([defaulted.statusCode, defaulted.json().allowedTiers]).toEqual([201, ["standard", "advanced"]]);
    });

    it("the newest package purchase decides; a newer top-up purchase does not", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard", "advanced", "premium", "frontier"], new Date("2026-01-01T00:00:00Z"));
      await buyPackage(user.id, ["standard"], new Date("2026-02-01T00:00:00Z"));
      const pack = await prisma.topUpPack.create({ data: { name: "T", active: true } });
      const packVersion = await prisma.topUpPackVersion.create({ data: { versionNumber: 1, createdBy: "test", reason: "test", packId: pack.id, priceUsdCents: 1, creditsGranted: 1 } });
      await prisma.purchaseSnapshot.create({ data: { buyerUserId: user.id, topUpPackVersionId: packVersion.id, ...SNAPSHOT_PRICE, creditsGranted: 1 } });

      const actual = await createKey(user, { allowedTiers: ["premium"] });

      expect(actual.statusCode).toBe(403);
      expect((await createKey(user, {})).json().allowedTiers).toEqual(["standard"]);
    });

    it("D111: a user without a package may create a key for the cheapest tier only", async () => {
      const user = await createUser(prisma);

      const refused = await createKey(user, { allowedTiers: ["advanced"] });
      const defaulted = await createKey(user, {});

      expect(refused.statusCode).toBe(403);
      expect([defaulted.statusCode, defaulted.json().allowedTiers]).toEqual([201, ["standard"]]);
    });

    it.each([
      ["an unknown tier", { allowedTiers: ["gold"] }],
      ["an empty tier list", { allowedTiers: [] }],
      ["a cap of 0", { monthlyCreditCap: 0 }],
      ["a negative cap", { monthlyCreditCap: -1 }],
      ["a cap below a micro-credit", { monthlyCreditCap: 0.0000001 }],
    ])("an invalid body (%s) is a 400, nothing stored", async (_name, payload) => {
      const user = await createUser(prisma);

      const actual = await createKey(user, payload);

      expect(actual.statusCode).toBe(400);
      expect(await prisma.apiKey.count()).toBe(0);
    });
  });

  it("the create and the list route answer the key's tiers and monthly cap (null: no cap)", async () => {
    const user = await createUser(prisma);
    await buyPackage(user.id, ["standard", "premium"]);

    const capped = await createKey(user, { name: "capped", allowedTiers: ["premium"], monthlyCreditCap: 12.5 });
    await createKey(user, { name: "open" });
    const list = await app.inject({ method: "GET", url: "/auth/keys", headers: signedIn(user) });

    expect(capped.json()).toMatchObject({ allowedTiers: ["premium"], monthlyCreditCap: "12.5" });
    expect(list.json().map((k: { name: string; allowedTiers: string[]; monthlyCreditCap: string | null }) => [k.name, k.allowedTiers, k.monthlyCreditCap]))
      .toEqual(expect.arrayContaining([["capped", ["premium"], "12.5"], ["open", ["standard", "premium"], null]]));
    expect(list.json()).toHaveLength(2);
  });

  it("AC8: POST /auth/keys/regenerate still answers a working key; it gets the package's tiers and no cap", async () => {
    const user = await createUser(prisma);
    await buyPackage(user.id, ["standard", "advanced"]);

    const actual = await app.inject({ method: "POST", url: "/auth/keys/regenerate", headers: signedIn(user) });

    expect(actual.statusCode).toBe(200);
    const key = await prisma.apiKey.findFirstOrThrow({ where: { userId: user.id, revokedAt: null } });
    expect([key.allowedTiers, key.monthlyCreditCap]).toEqual([["standard", "advanced"], null]);
    expect((await probe(actual.json().apiKey)).statusCode).toBe(200);
  });

  describe("AC6: the per-key rate limit (apiKeyRequestsPerMinute)", () => {
    it(`negative: with the setting at ${RATE_LIMIT}, a key's ${RATE_LIMIT + 1}st request inside a minute is a 429; control: a second key of the same user is not affected`, async () => {
      const user = await createUser(prisma);
      await prisma.platformSetting.create({ data: { name: "apiKeyRequestsPerMinute", value: RATE_LIMIT } });
      const first = await createApiKey(prisma, user.id);
      const second = await createApiKey(prisma, user.id);

      const statuses: number[] = [];
      for (let i = 0; i <= RATE_LIMIT; i++) statuses.push((await probe(first)).statusCode);
      const other = await probe(second);

      expect(statuses.slice(0, RATE_LIMIT).every((status) => status === 200)).toBe(true);
      expect(statuses[RATE_LIMIT]).toBe(429);
      expect(other.statusCode).toBe(200);
    });

    it("the setting decides the limit: at 2, the third request is a 429", async () => {
      const user = await createUser(prisma);
      await prisma.platformSetting.create({ data: { name: "apiKeyRequestsPerMinute", value: 2 } });
      const key = await createApiKey(prisma, user.id);

      const statuses = [(await probe(key)).statusCode, (await probe(key)).statusCode, (await probe(key)).statusCode];

      expect(statuses).toEqual([200, 200, 429]);
    });
  });
});
