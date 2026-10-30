import { Controller, Get } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Access } from "../../../common/decorators/access.decorator";
import { AuthModule } from "../auth.module";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createApiKey, createUser } from "../../../../test/factories";
import { asSessionUser } from "../../../../test/as-session-user";

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

// RNX-232 (18b, D47, D111), RNX-76 B2a: a key needs a package with API access; its allowed tiers are set at creation
// from all the user's packages plus the cheapest tier, its monthly cap is optional, the list shows both, regenerate gives the defaults, and each key has its own requests-per-minute limit.
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

  const signedIn = (user: { id: string; email: string }) => asSessionUser(user);
  const createKey = (user: { id: string; email: string }, payload: object) =>
    app.inject({ method: "POST", url: "/auth/keys", headers: signedIn(user), payload: { name: "k", expiresIn: "never", ...payload } });
  const probe = (apiKey: string) =>
    app.inject({ method: "GET", url: "/api-key-limits-probe", headers: { authorization: `Bearer ${apiKey}` } });

  /**
   * A package purchase of this user: a listed package, its version and the buyer's snapshot. The snapshot copies
   * `allowedTiers` and `apiAccess` (default true); `null` writes a legacy NULL snapshot value.
   */
  const buyPackage = async (buyerUserId: string, allowedTiers: string[], createdAt = new Date(), apiAccess: boolean | null = true) => {
    const version = { versionNumber: 1, createdBy: "test", reason: "test" };
    const pkg = await prisma.package.create({ data: { name: `P-${createdAt.getTime()}-${Math.random()}`, displayOrder: 1, active: true, visible: true } });
    const packageVersion = await prisma.packageVersion.create({
      data: { ...version, packageId: pkg.id, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: apiAccess ?? false, allowedChannels: [], allowedTiers },
    });
    await prisma.purchaseSnapshot.create({
      data: { buyerUserId, packageVersionId: packageVersion.id, ...SNAPSHOT_PRICE, creditsGranted: 1, apiAccess, allowedTiers, createdAt },
    });
    return pkg;
  };
  /** A top-up purchase of this user; its snapshot carries deliberately generous values that must not count. */
  const buyTopUp = async (buyerUserId: string) => {
    const pack = await prisma.topUpPack.create({ data: { name: `T-${Math.random()}`, active: true } });
    const packVersion = await prisma.topUpPackVersion.create({ data: { versionNumber: 1, createdBy: "test", reason: "test", packId: pack.id, priceUsdCents: 1, creditsGranted: 1 } });
    await prisma.purchaseSnapshot.create({ data: { buyerUserId, topUpPackVersionId: packVersion.id, ...SNAPSHOT_PRICE, creditsGranted: 1, apiAccess: true, allowedTiers: ["premium", "frontier"] } });
  };
  /** A listed package (not bought) whose current version grants `apiAccess` and `allowedTiers`, for the next-package hint. */
  const listPackage = (name: string, displayOrder: number, apiAccess: boolean, allowedTiers: string[]) =>
    prisma.package.create({ data: { name, displayOrder, active: true, visible: true, versions: { create: { versionNumber: 1, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess, allowedChannels: [], allowedTiers, createdBy: "test", reason: "test" } } } });
  const refusal = (res: { statusCode: number; json: () => { error?: unknown } }) => [res.statusCode, res.json().error];

  describe("RNX-76 B2a: API access comes from the package snapshots", () => {
    it("negative: without a package (free account, Q2), creating a key is a 400 PACKAGE_LIMIT_REACHED (apiAccess), nothing stored", async () => {
      const user = await createUser(prisma);
      await listPackage("Pro", 2, true, ["standard"]);

      const actual = await createKey(user, {});

      expect(refusal(actual)).toEqual([400, { type: "PACKAGE_LIMIT_REACHED", feature: "apiAccess", nextPackage: "Pro" }]);
      expect(await prisma.apiKey.count()).toBe(0);
    });

    it("negative: a package without API access refuses the key; the hint skips a later package without it", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard"], new Date(), false);
      await listPackage("Plus", 2, false, ["standard"]);
      await listPackage("Pro", 3, true, ["standard"]);

      const actual = await createKey(user, {});

      expect(refusal(actual)).toEqual([400, { type: "PACKAGE_LIMIT_REACHED", feature: "apiAccess", nextPackage: "Pro" }]);
      expect(await prisma.apiKey.count()).toBe(0);
    });

    it("negative: a top-up alone grants no API access, even when its snapshot says true", async () => {
      const user = await createUser(prisma);
      await buyTopUp(user.id);

      expect(refusal(await createKey(user, {}))).toEqual([400, { type: "PACKAGE_LIMIT_REACHED", feature: "apiAccess", nextPackage: null }]);
      expect(await prisma.apiKey.count()).toBe(0);
    });

    it("negative: a legacy snapshot whose apiAccess is NULL grants nothing", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard"], new Date(), null);

      expect((await createKey(user, {})).statusCode).toBe(400);
      expect(await prisma.apiKey.count()).toBe(0);
    });

    it.each([
      ["without API access, then with it", [false, true]],
      ["with API access, then without it", [true, false]],
      ["a legacy NULL, then with it", [null, true]],
    ] as const)("any package snapshot with API access grants it (%s)", async (_name, grants) => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard"], new Date("2026-01-01T00:00:00Z"), grants[0]);
      await buyPackage(user.id, ["standard"], new Date("2026-02-01T00:00:00Z"), grants[1]);

      expect((await createKey(user, {})).statusCode).toBe(201);
    });

    it("a later catalog version without API access does not take it from an earlier buyer", async () => {
      const user = await createUser(prisma);
      const pkg = await buyPackage(user.id, ["standard", "premium"]);
      await prisma.packageVersion.create({ data: { packageId: pkg.id, versionNumber: 2, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: false, allowedChannels: [], allowedTiers: ["standard"], createdBy: "test", reason: "lowered" } });

      const actual = await createKey(user, { allowedTiers: ["premium"] });

      expect([actual.statusCode, actual.json().allowedTiers]).toEqual([201, ["premium"]]);
    });

    it("negative: regenerate without API access is a 400, and the user's existing key keeps working", async () => {
      const user = await createUser(prisma);
      const oldKey = await createApiKey(prisma, user.id);

      const actual = await app.inject({ method: "POST", url: "/auth/keys/regenerate", headers: signedIn(user) });

      expect(refusal(actual)).toEqual([400, { type: "PACKAGE_LIMIT_REACHED", feature: "apiAccess", nextPackage: null }]);
      expect(await prisma.apiKey.count()).toBe(1);
      expect((await probe(oldKey)).statusCode).toBe(200);
    });
  });

  describe("AC2: the tiers a key may call are tiers the user's packages allow", () => {
    it("negative: a package without Premium refuses a key with Premium in its list (400 PACKAGE_LIMIT_REACHED, tier), and no key is stored", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard", "advanced"]);
      await listPackage("Pro", 2, true, ["standard", "premium"]);

      const actual = await createKey(user, { allowedTiers: ["standard", "premium"] });

      expect(refusal(actual)).toEqual([400, { type: "PACKAGE_LIMIT_REACHED", feature: "tier", requested: ["standard", "premium"], nextPackage: "Pro" }]);
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

    it.each([
      ["the larger package first", [["standard", "advanced", "premium", "frontier"], ["standard"]]],
      ["the smaller package first", [["standard"], ["standard", "advanced", "premium", "frontier"]]],
    ] as const)("every package purchase counts, whatever the order (%s); a top-up adds nothing", async (_name, tiers) => {
      const user = await createUser(prisma);
      await buyPackage(user.id, [...tiers[0]], new Date("2026-01-01T00:00:00Z"));
      await buyPackage(user.id, [...tiers[1]], new Date("2026-02-01T00:00:00Z"));
      await buyTopUp(user.id);

      expect((await createKey(user, { allowedTiers: ["premium"] })).statusCode).toBe(201);
      expect((await createKey(user, {})).json().allowedTiers).toEqual(["standard", "advanced", "premium", "frontier"]);
    });

    it("negative: a top-up's tiers do not count", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard"]);
      await buyTopUp(user.id);

      expect(refusal(await createKey(user, { allowedTiers: ["premium"] }))).toEqual([400, { type: "PACKAGE_LIMIT_REACHED", feature: "tier", requested: ["premium"], nextPackage: null }]);
      expect(await prisma.apiKey.count()).toBe(0);
    });

    it("Q1 (D111): the cheapest tier is always allowed, even when the package lists none of it", async () => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["advanced"]);

      const cheapest = await createKey(user, { allowedTiers: ["standard"] });
      const defaulted = await createKey(user, {});

      expect([cheapest.statusCode, cheapest.json().allowedTiers]).toEqual([201, ["standard"]]);
      expect(defaulted.json().allowedTiers).toEqual(["standard", "advanced"]);
    });

    it.each([
      ["an unknown tier", { allowedTiers: ["gold"] }],
      ["an empty tier list", { allowedTiers: [] }],
      ["a cap of 0", { monthlyCreditCap: 0 }],
      ["a negative cap", { monthlyCreditCap: -1 }],
      ["a cap below a micro-credit", { monthlyCreditCap: 0.0000001 }],
    ])("an invalid body (%s) is a 400, nothing stored", async (_name, payload) => {
      const user = await createUser(prisma);
      await buyPackage(user.id, ["standard"]);

      const actual = await createKey(user, payload);

      expect(actual.statusCode).toBe(400);
      expect(actual.json().error.type).toBe("invalid_request_error");
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
