import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { EntitlementService } from "./entitlement.service";

describe("EntitlementService (RNX-76 PR-A, snapshot-only read model)", () => {
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

  const snapshot = async (userId: string, versionId: string, collaborationEnabled: boolean | null) =>
    prisma.purchaseSnapshot.create({
      data: {
        buyerUserId: userId, packageVersionId: versionId, priceUsdCents: 100,
        exchangeRate: 16500, exchangeRateDate: new Date("2026-01-01"), exchangeRateSource: "test",
        priceRupiah: 165000, creditsGranted: 10, maxAgents: 4, maxConnectedTools: 3,
        apiAccess: true, allowedChannels: ["web"], allowedTiers: ["standard", "advanced"],
        collaborationEnabled,
      },
    });

  it("no package snapshot means no entitlement", async () => {
    const user = await createUser(prisma);
    expect(await service.getForUser(user.id)).toBeNull();
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

});
