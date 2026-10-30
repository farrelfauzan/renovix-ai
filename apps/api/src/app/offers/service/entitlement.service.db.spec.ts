import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { EntitlementService } from "./entitlement.service";

describe("EntitlementService (RNX-76 B1)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: EntitlementService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [EntitlementService] }));
    service = moduleRef.get(EntitlementService);
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  const packageVersion = async (collaborationEnabled: boolean, name = "Enterprise") => {
    const pkg = await prisma.package.create({ data: { name, displayOrder: 2, active: true, visible: true } });
    return prisma.packageVersion.create({
      data: {
        packageId: pkg.id, versionNumber: 1, priceUsdCents: 100, creditsGranted: 10,
        billing: "one_time", maxAgents: 4, maxConnectedTools: 3, apiAccess: true,
        allowedChannels: ["web"], allowedTiers: ["standard", "advanced"],
        collaborationEnabled, createdBy: "test", reason: "RNX-76",
      },
    });
  };

  const snapshot = async (userId: string, versionId: string, collaborationEnabled: boolean | null, overrides: { maxAgents?: number | null; maxConnectedTools?: number | null; createdAt?: Date } = {}) =>
    prisma.purchaseSnapshot.create({
      data: {
        buyerUserId: userId, packageVersionId: versionId, priceUsdCents: 100, ...overrides,
        exchangeRate: 16500, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test",
        priceRupiah: 165000, creditsGranted: 10, maxAgents: 4, maxConnectedTools: 3,
        apiAccess: true, allowedChannels: ["web"], allowedTiers: ["standard", "advanced"],
        collaborationEnabled, ...overrides,
      },
    });

  it("no package snapshot means no entitlement", async () => {
    const user = await createUser(prisma);
    expect(await service.getForUser(user.id)).toBeNull();
  });

  it("no package snapshot has a zero limit and is denied with numeric details", async () => {
    const user = await createUser(prisma);
    await expect(service.requireLimit(user.id, "maxAgents", 0)).rejects.toMatchObject({
      response: { error: { type: "PACKAGE_LIMIT_REACHED", feature: "maxAgents", used: 0, limit: 0, nextPackage: null } },
    });
  });

  it("aggregates all snapshots with max, OR and deterministic unions", async () => {
    const user = await createUser(prisma);
    const first = await packageVersion(false, "Starter");
    const second = await packageVersion(true, "Pro");
    await snapshot(user.id, first.id, null);
    await prisma.purchaseSnapshot.create({ data: { buyerUserId: user.id, packageVersionId: second.id, priceUsdCents: 100, exchangeRate: 16500, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 165000, creditsGranted: 10, maxAgents: 9, maxConnectedTools: 7, apiAccess: false, allowedChannels: ["whatsapp"], allowedTiers: ["premium"], collaborationEnabled: true } });
    const result = await service.getForUser(user.id);
    expect(result).toMatchObject({ maxAgents: 9, maxConnectedTools: 7, apiAccess: true, collaborationEnabled: true });
    expect(result?.allowedChannels).toEqual(["web", "whatsapp"]);
    expect(result?.allowedTiers).toEqual(["advanced", "premium", "standard"]);
  });

  it.each([
    ["Starter", "Pro", 4, 9],
    ["Pro", "Starter", 9, 4],
  ])("aggregates %s -> %s snapshots regardless of purchase order", async (_first, _second, firstAgents, secondAgents) => {
    const user = await createUser(prisma);
    const first = await packageVersion(false, _first);
    const second = await packageVersion(true, _second);
    await snapshot(user.id, first.id, false, { maxAgents: firstAgents, createdAt: new Date("2026-01-01") });
    await snapshot(user.id, second.id, true, { maxAgents: secondAgents, createdAt: new Date("2026-02-01") });
    expect((await service.getForUser(user.id))?.maxAgents).toBe(Math.max(firstAgents, secondAgents));
  });

  it("aggregates equal-timestamp snapshots independent of insertion order", async () => {
    const user = await createUser(prisma);
    const first = await packageVersion(false, "Starter");
    const second = await packageVersion(true, "Pro");
    await prisma.purchaseSnapshot.createMany({ data: [
      { buyerUserId: user.id, packageVersionId: first.id, priceUsdCents: 1, exchangeRate: 1, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 1, creditsGranted: 1, maxAgents: 2, maxConnectedTools: 1, apiAccess: false, allowedChannels: ["z"], allowedTiers: ["standard"], collaborationEnabled: false, createdAt: new Date("2026-03-01") },
      { buyerUserId: user.id, packageVersionId: second.id, priceUsdCents: 1, exchangeRate: 1, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 1, creditsGranted: 1, maxAgents: 7, maxConnectedTools: 4, apiAccess: true, allowedChannels: ["a"], allowedTiers: ["premium"], collaborationEnabled: true, createdAt: new Date("2026-03-01") },
    ] });
    expect(await service.getForUser(user.id)).toMatchObject({ maxAgents: 7, allowedChannels: ["a", "z"], allowedTiers: ["premium", "standard"] });
  });

  it("keeps Enterprise limits when a smaller package is purchased later", async () => {
    const user = await createUser(prisma);
    const enterprise = await packageVersion(true, "Enterprise");
    const smaller = await packageVersion(false, "Starter");
    await snapshot(user.id, enterprise.id, true, { maxAgents: 100, createdAt: new Date("2026-01-01") });
    await snapshot(user.id, smaller.id, false, { maxAgents: 2, createdAt: new Date("2026-02-01") });
    expect((await service.getForUser(user.id))?.maxAgents).toBe(100);
  });

  it("excludes deliberately high top-up fields from package aggregation", async () => {
    const user = await createUser(prisma);
    const version = await packageVersion(false, "Starter");
    await snapshot(user.id, version.id, false);
    const pack = await prisma.topUpPack.create({ data: { name: "High top-up", active: true } });
    const packVersion = await prisma.topUpPackVersion.create({ data: { packId: pack.id, versionNumber: 1, creditsGranted: 1, priceUsdCents: 1, createdBy: "test", reason: "test" } });
    await prisma.purchaseSnapshot.create({ data: { buyerUserId: user.id, topUpPackVersionId: packVersion.id, priceUsdCents: 1, exchangeRate: 1, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 1, creditsGranted: 999, maxAgents: 999, maxConnectedTools: 999, apiAccess: true, allowedChannels: ["topup"], allowedTiers: ["topup"], collaborationEnabled: true } });
    expect(await service.getForUser(user.id)).toMatchObject({ maxAgents: 4, maxConnectedTools: 3, apiAccess: true, allowedChannels: ["web"] });
  });

  it("normalizes legacy null numeric fields while preserving non-null values", async () => {
    const user = await createUser(prisma);
    const version = await packageVersion(false, "Starter");
    await prisma.purchaseSnapshot.create({ data: { buyerUserId: user.id, packageVersionId: version.id, priceUsdCents: 1, exchangeRate: 1, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 1, creditsGranted: 1, maxAgents: null, maxConnectedTools: 5, apiAccess: true, allowedChannels: [], allowedTiers: [], collaborationEnabled: null } });
    expect(await service.getForUser(user.id)).toMatchObject({ maxAgents: 0, maxConnectedTools: 5, collaborationEnabled: false });
  });

  it("suggests the first visible catalog package after the highest owned display order", async () => {
    const user = await createUser(prisma);
    const owned = await packageVersion(false, "Starter");
    await snapshot(user.id, owned.id, false);
    await prisma.package.create({ data: { name: "Pro", displayOrder: 3, active: true, visible: true, versions: { create: { versionNumber: 1, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 5, maxConnectedTools: 3, apiAccess: true, allowedChannels: [], allowedTiers: [], createdBy: "test", reason: "test" } } } });
    await expect(service.requireLimit(user.id, "maxAgents", 4)).rejects.toMatchObject({ response: { error: { used: 4, limit: 4, nextPackage: "Pro" } } });
  });

  it("uses the current version before applying the next-package limit", async () => {
    const user = await createUser(prisma);
    const owned = await packageVersion(false, "Starter");
    await snapshot(user.id, owned.id, false);
    const candidate = await prisma.package.create({ data: { name: "Lowered", displayOrder: 3, active: true, visible: true, versions: { create: { versionNumber: 1, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 5, maxConnectedTools: 5, apiAccess: true, allowedChannels: [], allowedTiers: [], createdBy: "test", reason: "old" } } } });
    await prisma.packageVersion.create({ data: { packageId: candidate.id, versionNumber: 2, effectiveFrom: new Date("2026-01-01"), priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 0, maxConnectedTools: 0, apiAccess: false, allowedChannels: [], allowedTiers: [], createdBy: "test", reason: "lowered" } });
    await expect(service.requireLimit(user.id, "maxAgents", 5)).rejects.toMatchObject({ response: { error: { nextPackage: null } } });
  });

  it("skips more than ten nonqualifying packages", async () => {
    const user = await createUser(prisma);
    const owned = await packageVersion(false, "Starter");
    await snapshot(user.id, owned.id, false);
    for (let order = 3; order < 15; order += 1) await prisma.package.create({ data: { name: `No-${order}`, displayOrder: order, active: true, visible: true, versions: { create: { versionNumber: 1, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: false, allowedChannels: [], allowedTiers: [], createdBy: "test", reason: "test" } } } });
    await prisma.package.create({ data: { name: "Useful", displayOrder: 15, active: true, visible: true, versions: { create: { versionNumber: 1, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 5, maxConnectedTools: 5, apiAccess: true, allowedChannels: [], allowedTiers: [], createdBy: "test", reason: "test" } } } });
    await expect(service.requireLimit(user.id, "maxAgents", 4)).rejects.toMatchObject({ response: { error: { nextPackage: "Useful" } } });
  });

  it("suggests a useful listed package for a user with no snapshot", async () => {
    const user = await createUser(prisma);
    await prisma.package.create({ data: { name: "Free", displayOrder: 1, active: true, visible: true, versions: { create: { versionNumber: 1, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 2, maxConnectedTools: 1, apiAccess: false, allowedChannels: [], allowedTiers: [], createdBy: "test", reason: "test" } } } });
    await expect(service.requireLimit(user.id, "maxAgents", 1)).rejects.toMatchObject({ response: { error: { nextPackage: "Free" } } });
    await expect(service.requireLimit(user.id, "maxAgents", 2)).rejects.toMatchObject({ response: { error: { nextPackage: null } } });
  });

  it.each([true, false])("reads collaborationEnabled=%s from the snapshot", async (flag) => {
    const user = await createUser(prisma);
    const version = await packageVersion(flag);
    await snapshot(user.id, version.id, flag);
    expect((await service.getForUser(user.id))?.collaborationEnabled).toBe(flag);
  });

  it("a legacy package snapshot with NULL collaborationEnabled resolves false", async () => {
    const user = await createUser(prisma);
    const version = await packageVersion(true);
    await snapshot(user.id, version.id, null);
    expect((await service.getForUser(user.id))?.collaborationEnabled).toBe(false);
  });

  it("a top-up snapshot has no package entitlement and never carries collaboration", async () => {
    const user = await createUser(prisma);
    const pack = await prisma.topUpPack.create({ data: { name: "Top-up test", active: true } });
    const packVersion = await prisma.topUpPackVersion.create({ data: { packId: pack.id, versionNumber: 1, creditsGranted: 10, priceUsdCents: 1, createdBy: "test", reason: "test" } });
    await prisma.purchaseSnapshot.create({
      data: { buyerUserId: user.id, topUpPackVersionId: packVersion.id, priceUsdCents: 1, exchangeRate: 1, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test", priceRupiah: 1, creditsGranted: 10, allowedChannels: [], allowedTiers: [] },
    });
    expect(await service.getForUser(user.id)).toBeNull();
  });

  it("a later catalog version does not lower the purchased snapshot flag", async () => {
    const user = await createUser(prisma);
    const old = await packageVersion(true);
    await snapshot(user.id, old.id, true);
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: old.packageId } });
    await prisma.packageVersion.create({ data: { packageId: pkg.id, versionNumber: 2, priceUsdCents: 100, creditsGranted: 10, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: false, allowedChannels: [], allowedTiers: ["standard"], collaborationEnabled: false, createdBy: "test", reason: "lowered" } });
    expect((await service.getForUser(user.id))?.collaborationEnabled).toBe(true);
  });

  it("paid snapshot without user_subscriptions is still the entitlement source", async () => {
    const user = await createUser(prisma);
    const version = await packageVersion(true);
    await snapshot(user.id, version.id, true);
    expect((await service.getForUser(user.id))?.maxAgents).toBe(4);
  });

  it("renaming the package does not change the snapshot flag", async () => {
    const user = await createUser(prisma);
    const version = await packageVersion(true, "Renamed package");
    await snapshot(user.id, version.id, true);
    expect((await service.getForUser(user.id))?.collaborationEnabled).toBe(true);
  });

  describe("RNX-76 B2a: API access and tiers", () => {
    const listed = (name: string, displayOrder: number, terms: { apiAccess: boolean; allowedTiers: string[] }) =>
      prisma.package.create({ data: { name, displayOrder, active: true, visible: true, versions: { create: { versionNumber: 1, priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, allowedChannels: [], ...terms, createdBy: "test", reason: "test" } } } });

    it("requireApiAccess refuses an account without a package and names the first listed package with API access", async () => {
      const user = await createUser(prisma);
      await listed("Basic", 1, { apiAccess: false, allowedTiers: ["standard"] });
      await listed("Pro", 2, { apiAccess: true, allowedTiers: ["standard"] });
      await expect(service.requireApiAccess(user.id)).rejects.toMatchObject({
        response: { error: { type: "PACKAGE_LIMIT_REACHED", feature: "apiAccess", nextPackage: "Pro" } },
      });
    });

    it("requireApiAccess answers the aggregated entitlement when one package grants it", async () => {
      const user = await createUser(prisma);
      const version = await packageVersion(false, "Starter");
      await snapshot(user.id, version.id, false, {});
      expect(await service.requireApiAccess(user.id)).toMatchObject({ apiAccess: true, packageName: "Starter" });
    });

    it("requireTiers without a package allows the cheapest tier only (Q1, D111)", async () => {
      expect(await service.requireTiers(null, ["standard"])).toEqual(["standard"]);
      await expect(service.requireTiers(null, ["advanced"])).rejects.toMatchObject({
        response: { error: { feature: "tier", requested: ["advanced"], nextPackage: null } },
      });
    });

    it("requireTiers adds the cheapest tier to the packages' union, in tier order", async () => {
      const user = await createUser(prisma);
      const version = await packageVersion(false, "Starter");
      await snapshot(user.id, version.id, false, {});
      const entitlement = await service.getForUser(user.id);
      expect(await service.requireTiers(entitlement, [])).toEqual(["standard", "advanced"]);
    });

    it("the tier hint skips a package whose current version no longer has every requested tier", async () => {
      const lowered = await listed("Lowered", 2, { apiAccess: true, allowedTiers: ["standard", "premium"] });
      await prisma.packageVersion.create({ data: { packageId: lowered.id, versionNumber: 2, effectiveFrom: new Date("2026-01-01"), priceUsdCents: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: true, allowedChannels: [], allowedTiers: ["standard"], createdBy: "test", reason: "lowered" } });
      await listed("Partial", 3, { apiAccess: true, allowedTiers: ["premium"] });
      await listed("Max", 4, { apiAccess: true, allowedTiers: ["premium", "frontier"] });
      await expect(service.requireTiers(null, ["premium", "frontier"])).rejects.toMatchObject({
        response: { error: { nextPackage: "Max" } },
      });
    });
  });
});
