import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { OfferSeedDto } from "../dto/offer-seed.dto";
import { OfferCatalogService } from "./offer-catalog.service";
import { OfferSeedService } from "./offer-seed.service";
import { PlatformSettingsService } from "./platform-settings.service";

// RX-86: the offer seed (prisma/offers.seed.json, `bun run seed:offers`) on the test database. Idempotent: the
// same file twice writes nothing the second time; a changed price creates a new version and a change record.

const SHIPPED_SEED_FILE = resolve(__dirname, "../../../../../../prisma/offers.seed.json");
const readShippedSeed = (): OfferSeedDto => OfferSeedDto.parse(JSON.parse(readFileSync(SHIPPED_SEED_FILE, "utf8")));

// EXAMPLE seed for these tests only, NOT decided prices or limits (RX-53 decides them, in the shipped file).
const EXAMPLE_SEED: OfferSeedDto = {
  reason: "example seed",
  defaultAllowedTiers: ["standard", "advanced", "premium", "frontier"],
  settings: { weeklyFreeAllowanceCredits: 3 },
  packages: [
    {
      name: "Pro",
      displayOrder: 2,
      active: true,
      visible: true,
      version: { priceUsdCents: 1900, creditsGranted: 20, billing: "one_time", maxAgents: 10, maxConnectedTools: 5, apiAccess: true, allowedChannels: ["web"] },
    },
  ],
  topUpPacks: [{ name: "Example pack", active: true, version: { creditsGranted: 10, priceUsdCents: 500 } }],
  enterpriseBundles: [{ name: "Example bundle", active: true, version: { poolCreditsPerPeriod: null, monthlyPriceUsdCents: null } }],
};

describe("OfferSeedService (RX-86, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let seeder: OfferSeedService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [OfferSeedService, OfferCatalogService, PlatformSettingsService] }));
    seeder = moduleRef.get(OfferSeedService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => moduleRef?.close());

  const countRows = async () => ({
    packages: await prisma.package.count(),
    packageVersions: await prisma.packageVersion.count(),
    packs: await prisma.topUpPack.count(),
    packVersions: await prisma.topUpPackVersion.count(),
    bundles: await prisma.enterpriseBundle.count(),
    bundleVersions: await prisma.enterpriseBundleVersion.count(),
    settings: await prisma.platformSetting.count(),
    changes: await prisma.catalogChange.count(),
  });

  it("the shipped file holds the decided settings and the three D237 top-up packs, and no package version or bundle", () => {
    const actual = readShippedSeed();
    expect(actual.settings).toEqual({
      weeklyFreeAllowanceCredits: 2,
      runOutAmberDays: 7,
      runOutRedDays: 2,
      runOutFloorCredits: 1,
      peerRunMaxDepth: 2,
      peerRunMaxAgentCalls: 5,
      peerRunMaxModelCalls: 30,
      peerRunCallTimeoutSeconds: 60,
      peerRunMaxMinutes: 5,
      perRunCreditCap: 10,
      perRunCreditCapFloor: 1,
      seatCeiling: 100,
      apiKeyRequestsPerMinute: 60,
      anonymousRequestsPerSession: 20,
      anonymousSessionsPerIp: 3,
      invitationGrantCredits: 5,
    });
    expect(actual.packages.map((p) => [p.name, p.version])).toEqual([
      ["Starter", null],
      ["Pro", null],
      ["Enterprise", null],
    ]);
    expect(actual.topUpPacks).toEqual([
      { name: "Top-up 20 credits", active: true, version: { creditsGranted: 20, priceUsdCents: 500 } },
      { name: "Top-up 100 credits", active: true, version: { creditsGranted: 100, priceUsdCents: 2000 } },
      { name: "Top-up 200 credits", active: true, version: { creditsGranted: 200, priceUsdCents: 3600 } },
    ]);
    expect(actual.enterpriseBundles).toEqual([]);
    expect(actual.defaultAllowedTiers).toEqual(["standard", "advanced", "premium", "frontier"]);
  });

  it("applying the shipped file twice gives the same rows, and the second run writes no change record", async () => {
    await seeder.applySeed(readShippedSeed(), "test");
    const expected = await countRows();
    await seeder.applySeed(readShippedSeed(), "test");
    expect(await countRows()).toEqual(expected);
    expect(expected).toMatchObject({ packages: 3, packageVersions: 0, packs: 3, packVersions: 3, settings: 16, changes: 25 });
    expect(await prisma.catalogChange.count({ where: { NOT: { changedBy: "seed:test" } } })).toBe(0);
  });

  it("RNX-53 (D237): applying the shipped file stores the three top-up packs, active, with US$5/20, US$20/100 and US$36/200 credits", async () => {
    await seeder.applySeed(readShippedSeed(), "test");
    const actual = await prisma.topUpPack.findMany({ include: { versions: true } });
    const actualByCredits = actual
      .map(({ name, active, versions }) => ({ name, active, versions: versions.map((v) => [v.priceUsdCents, v.creditsGranted.toNumber()]) }))
      .sort((a, b) => a.versions[0][1] - b.versions[0][1]);
    expect(actualByCredits).toEqual([
      { name: "Top-up 20 credits", active: true, versions: [[500, 20]] },
      { name: "Top-up 100 credits", active: true, versions: [[2000, 100]] },
      { name: "Top-up 200 credits", active: true, versions: [[3600, 200]] },
    ]);
  });

  it("is idempotent with versions; a changed price creates a new version and a change record and leaves the old version as it was", async () => {
    await seeder.applySeed(EXAMPLE_SEED, "test");
    const firstRun = await countRows();
    const oldVersion = await prisma.packageVersion.findFirstOrThrow();
    await seeder.applySeed(EXAMPLE_SEED, "test");
    expect(await countRows()).toEqual(firstRun);
    const [pro] = EXAMPLE_SEED.packages;
    const inputChangedSeed: OfferSeedDto = { ...EXAMPLE_SEED, reason: "price change", packages: [{ ...pro, version: pro.version && { ...pro.version, priceUsdCents: 2500 } }] };
    await seeder.applySeed(inputChangedSeed, "test");
    expect(await countRows()).toEqual({ ...firstRun, packageVersions: 2, changes: firstRun.changes + 1 });
    expect(await prisma.packageVersion.findUniqueOrThrow({ where: { id: oldVersion.id } })).toEqual(oldVersion);
    const newVersion = await prisma.packageVersion.findFirstOrThrow({ where: { versionNumber: 2 } });
    expect(newVersion).toMatchObject({ priceUsdCents: 2500, allowedTiers: ["standard", "advanced", "premium", "frontier"], createdBy: "seed:test", reason: "price change" });
    expect(await prisma.catalogChange.findFirstOrThrow({ where: { entityId: newVersion.id } })).toMatchObject({ changedBy: "seed:test", reason: "price change" });
  });

  it("is one transaction: a refused item rolls back everything the run wrote before it", async () => {
    const [pro] = EXAMPLE_SEED.packages;
    const inputBadSeed = { ...EXAMPLE_SEED, packages: [{ ...pro, version: pro.version && { ...pro.version, priceUsdCents: -1 } }] } as OfferSeedDto;
    await expect(seeder.applySeed(inputBadSeed, "test")).rejects.toThrow("priceUsdCents");
    expect(await countRows()).toEqual({ packages: 0, packageVersions: 0, packs: 0, packVersions: 0, bundles: 0, bundleVersions: 0, settings: 0, changes: 0 });
  });

  it("refuses a file with an unknown setting name", () => {
    expect(OfferSeedDto.safeParse({ ...EXAMPLE_SEED, settings: { freeCreditsForEveryone: 1 } }).success).toBe(false);
  });
});
