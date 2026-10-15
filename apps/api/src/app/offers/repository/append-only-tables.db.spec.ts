import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";

// RX-86: the database itself refuses UPDATE and DELETE on version rows, purchase snapshots and change records
// (triggers of migration 20261015150000_offer_catalog), whoever runs the SQL. TRUNCATE stays allowed for the
// test tooling. The rows are written directly with the client; their values are throwaway.

const APPEND_ONLY_TABLES = ["package_versions", "top_up_pack_versions", "enterprise_bundle_versions", "purchase_snapshots", "catalog_changes"];

describe("Append-only offer tables (RX-86, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ids: { packageVersionId: string; packVersionId: string; buyerId: string };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const version = { versionNumber: 1, createdBy: "test", reason: "test" };
    const pkg = await prisma.package.create({ data: { name: "P", displayOrder: 1, active: true, visible: true } });
    const packageVersion = await prisma.packageVersion.create({
      data: { ...version, packageId: pkg.id, priceRupiah: 1, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: false, allowedChannels: [], allowedTiers: ["standard"] },
    });
    const pack = await prisma.topUpPack.create({ data: { name: "T", active: true } });
    const packVersion = await prisma.topUpPackVersion.create({ data: { ...version, packId: pack.id, priceRupiah: 1, creditsGranted: 1 } });
    const bundle = await prisma.enterpriseBundle.create({ data: { name: "B", active: true } });
    await prisma.enterpriseBundleVersion.create({ data: { ...version, bundleId: bundle.id } });
    const buyer = await createUser(prisma);
    await prisma.purchaseSnapshot.create({ data: { buyerUserId: buyer.id, packageVersionId: packageVersion.id, priceRupiah: 1, creditsGranted: 1 } });
    await prisma.catalogChange.create({ data: { entity: "package", entityId: pkg.id, changedBy: "test", reason: "test", after: {} } });
    ids = { packageVersionId: packageVersion.id, packVersionId: packVersion.id, buyerId: buyer.id };
  });

  afterAll(() => moduleRef?.close());

  it.each(APPEND_ONLY_TABLES)("refuses UPDATE on %s", async (table) => {
    await expect(prisma.$executeRawUnsafe(`UPDATE "${table}" SET "created_at" = now()`)).rejects.toThrow(`${table} is append-only: UPDATE is refused`);
    expect(await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`)).toEqual([{ n: 1n }]);
  });

  it.each(APPEND_ONLY_TABLES)("refuses DELETE on %s", async (table) => {
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow(`${table} is append-only: DELETE is refused`);
    expect(await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`)).toEqual([{ n: 1n }]);
  });

  it("refuses a price edit of a version a purchase points at, also through the client", async () => {
    await expect(prisma.packageVersion.update({ where: { id: ids.packageVersionId }, data: { priceRupiah: 2 } })).rejects.toThrow("append-only");
    expect((await prisma.packageVersion.findUniqueOrThrow({ where: { id: ids.packageVersionId } })).priceRupiah).toBe(1);
  });

  it.each([
    ["no version", {}],
    ["both a package version and a pack version", "both"],
  ])("refuses a snapshot with %s (one-version CHECK)", async (_case, which) => {
    const versions = which === "both" ? { packageVersionId: ids.packageVersionId, topUpPackVersionId: ids.packVersionId } : {};
    await expect(prisma.purchaseSnapshot.create({ data: { ...versions, buyerUserId: ids.buyerId, priceRupiah: 1, creditsGranted: 1 } })).rejects.toThrow("purchase_snapshots_one_version_check");
  });

  it("resetDatabase still empties the append-only tables (TRUNCATE is not refused)", async () => {
    await resetDatabase(prisma);
    for (const table of APPEND_ONLY_TABLES) expect(await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`)).toEqual([{ n: 0n }]);
  });
});
