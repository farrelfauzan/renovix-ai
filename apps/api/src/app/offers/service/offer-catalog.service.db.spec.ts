import { BadRequestException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import type { PackageVersionTermsDto } from "../dto/package-version-terms.dto";
import { CatalogChangeRepository } from "../repository/catalog-change.repository";
import { OfferCatalogService } from "./offer-catalog.service";
import { PurchaseSnapshotService } from "./purchase-snapshot.service";

// RX-86: the offer catalog on the test database. Versions are never edited: new terms create a new version,
// and a purchase snapshot keeps what was bought (D37). Every write writes its change record in its transaction.

// EXAMPLE values for these tests only, NOT decided prices or limits: RX-53 decides them, and they are set only
// in prisma/offers.seed.json.
const EXAMPLE_PRO_TERMS: PackageVersionTermsDto = {
  priceRupiah: 149000,
  creditsGranted: 20.5,
  billing: "one_time",
  maxAgents: 10,
  maxConnectedTools: 5,
  apiAccess: true,
  allowedChannels: ["web", "api"],
  allowedTiers: ["standard", "advanced", "premium", "frontier"],
};
const EXAMPLE_PRO_TERMS_AFTER_CHANGE: PackageVersionTermsDto = { ...EXAMPLE_PRO_TERMS, priceRupiah: 199000, creditsGranted: 25, maxAgents: 12 };
const EXAMPLE_PRO = { name: "Pro", displayOrder: 2, active: true, visible: true };
const AUTHOR = { changedBy: "admin-test", reason: "test change" };

describe("OfferCatalogService (RX-86, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let catalog: OfferCatalogService;
  let purchases: PurchaseSnapshotService;
  let changes: CatalogChangeRepository;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [OfferCatalogService, PurchaseSnapshotService] }));
    catalog = moduleRef.get(OfferCatalogService);
    purchases = moduleRef.get(PurchaseSnapshotService);
    changes = moduleRef.get(CatalogChangeRepository);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  it("AC1: after a price change for Pro, an earlier buyer's snapshot still holds the old price, credits and limits; the old version is unchanged and a new one exists", async () => {
    const pro = await catalog.savePackage(EXAMPLE_PRO, AUTHOR);
    const oldVersion = await catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS, author: AUTHOR });
    const buyer = await createUser(prisma);
    const snapshot = await purchases.recordPackagePurchase({ buyerUserId: buyer.id, versionId: oldVersion.id, paymentId: null });
    const newVersion = await catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS_AFTER_CHANGE, author: AUTHOR });
    const actualSnapshot = await prisma.purchaseSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } });
    expect({
      priceRupiah: actualSnapshot.priceRupiah,
      creditsGranted: Number(actualSnapshot.creditsGranted),
      billing: actualSnapshot.billing,
      maxAgents: actualSnapshot.maxAgents,
      maxConnectedTools: actualSnapshot.maxConnectedTools,
      apiAccess: actualSnapshot.apiAccess,
      allowedChannels: actualSnapshot.allowedChannels,
      allowedTiers: actualSnapshot.allowedTiers,
    }).toEqual(EXAMPLE_PRO_TERMS);
    expect(actualSnapshot.packageVersionId).toBe(oldVersion.id);
    expect(await prisma.packageVersion.findUniqueOrThrow({ where: { id: oldVersion.id } })).toEqual(oldVersion);
    expect(newVersion.id).not.toBe(oldVersion.id);
    expect({ versionNumber: newVersion.versionNumber, priceRupiah: newVersion.priceRupiah }).toEqual({ versionNumber: 2, priceRupiah: 199000 });
    expect(await prisma.packageVersion.count({ where: { packageId: pro.id } })).toBe(2);
  });

  it("writes a change record for the new version, with the previous version as before and its effective time", async () => {
    const pro = await catalog.savePackage(EXAMPLE_PRO, AUTHOR);
    const oldVersion = await catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS, author: AUTHOR });
    const inputEffectiveFrom = new Date("2027-01-01T00:00:00.000Z");
    const newVersion = await catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS_AFTER_CHANGE, effectiveFrom: inputEffectiveFrom, author: AUTHOR });
    const actual = await prisma.catalogChange.findFirstOrThrow({ where: { entity: "package_version", entityId: newVersion.id } });
    expect(actual).toMatchObject({ changedBy: "admin-test", reason: "test change", effectiveFrom: inputEffectiveFrom });
    expect(actual.before).toMatchObject({ id: oldVersion.id, priceRupiah: 149000, creditsGranted: "20.5" });
    expect(actual.after).toMatchObject({ id: newVersion.id, priceRupiah: 199000, versionNumber: 2 });
    expect(newVersion).toMatchObject({ createdBy: "admin-test", reason: "test change", effectiveFrom: inputEffectiveFrom });
  });

  it("saving the same package and terms again writes no version and no change record", async () => {
    const pro = await catalog.savePackage(EXAMPLE_PRO, AUTHOR);
    const version = await catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS, author: AUTHOR });
    const changesBefore = await prisma.catalogChange.count();
    const actualPackage = await catalog.savePackage(EXAMPLE_PRO, AUTHOR);
    const actualVersion = await catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS, author: AUTHOR });
    expect(actualPackage).toEqual(pro);
    expect(actualVersion).toEqual(version);
    expect(await prisma.catalogChange.count()).toBe(changesBefore);
    expect(changesBefore).toBe(2);
  });

  it("updates a package's flags with a change record holding before and after", async () => {
    const pro = await catalog.savePackage({ ...EXAMPLE_PRO, active: false }, AUTHOR);
    await catalog.savePackage(EXAMPLE_PRO, AUTHOR);
    const actual = await prisma.catalogChange.findMany({ where: { entity: "package", entityId: pro.id }, orderBy: { createdAt: "asc" } });
    expect(actual.map((c) => [(c.before as { active: boolean } | null)?.active ?? null, (c.after as { active: boolean }).active])).toEqual([
      [null, false],
      [false, true],
    ]);
  });

  it.each([
    ["a negative price", { priceRupiah: -1 }],
    ["credits finer than a micro-credit", { creditsGranted: 0.0000001 }],
    ["an unknown tier", { allowedTiers: ["ultra"] }],
    ["no allowed tier", { allowedTiers: [] }],
  ])("refuses a version with %s and writes nothing", async (_case, change) => {
    const pro = await catalog.savePackage(EXAMPLE_PRO, AUTHOR);
    const inputTerms = { ...EXAMPLE_PRO_TERMS, ...change } as PackageVersionTermsDto;
    await expect(catalog.savePackageVersion({ ownerId: pro.id, terms: inputTerms, author: AUTHOR })).rejects.toThrow(BadRequestException);
    expect(await prisma.packageVersion.count()).toBe(0);
    expect(await prisma.catalogChange.count()).toBe(1);
  });

  it("rolls the new version back when its change record cannot be written", async () => {
    const pro = await catalog.savePackage(EXAMPLE_PRO, AUTHOR);
    jest.spyOn(changes, "create").mockRejectedValueOnce(new Error("change record insert failed"));
    await expect(catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS, author: AUTHOR })).rejects.toThrow("change record insert failed");
    expect(await prisma.packageVersion.count()).toBe(0);
  });

  it("rolls the new package back when its change record cannot be written", async () => {
    jest.spyOn(changes, "create").mockRejectedValueOnce(new Error("change record insert failed"));
    await expect(catalog.savePackage(EXAMPLE_PRO, AUTHOR)).rejects.toThrow("change record insert failed");
    expect(await prisma.package.count()).toBe(0);
  });

  it("records a top-up purchase with the pack version's price and credits, and no limits", async () => {
    const pack = await catalog.saveTopUpPack({ name: "Example pack", active: true }, AUTHOR);
    const version = await catalog.saveTopUpPackVersion({ ownerId: pack.id, terms: { creditsGranted: 10, priceRupiah: 50000 }, author: AUTHOR });
    const buyer = await createUser(prisma);
    const actual = await purchases.recordTopUpPurchase({ buyerUserId: buyer.id, versionId: version.id, paymentId: "example-payment" });
    expect(actual).toMatchObject({ topUpPackVersionId: version.id, packageVersionId: null, priceRupiah: 50000, maxAgents: null, billing: null, paymentId: "example-payment" });
    expect(Number(actual.creditsGranted)).toBe(10);
  });
});
