import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase, testDatabaseUrl } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../../billing/service/package-ownership.service";
import { CodesService } from "../../codes/service/codes.service";
import { OffersModule } from "../../offers/offers.module";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { DevAccountSeedService } from "./dev-account-seed.service";

// RNX-355: the dev account seed on the test database.

describe("DevAccountSeedService (RNX-355, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: DevAccountSeedService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [OffersModule], providers: [DevAccountSeedService, CodesService, CreditLedgerService, PackageOwnershipService, PlatformSettingsService] }));
    service = moduleRef.get(DevAccountSeedService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.package.create({ data: { name: "Starter", displayOrder: 1, active: false, visible: false } });
    // CodesService.redeemCode reads this setting for any code that grants credits, even one with its own creditAmount.
    await moduleRef.get(PlatformSettingsService).saveSetting({ name: "invitationGrantCredits", value: 5, author: { changedBy: "test", reason: "redeemCode reads it" } });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  const countRows = async () => ({
    users: await prisma.user.count(),
    codes: await prisma.invitationCode.count(),
    redemptions: await prisma.codeRedemption.count(),
    ledgerEntries: await prisma.creditLedgerEntry.count(),
    snapshots: await prisma.purchaseSnapshot.count(),
    packageVersions: await prisma.packageVersion.count(),
  });

  const paidBalanceOf = async (userId: string) => Number((await prisma.creditAccount.findFirst({ where: { userId, wallet: "paid" } }))?.balance ?? 0);

  it("AC1: gives an existing account a package snapshot and 20 paid credits in exactly one ledger entry", async () => {
    const inputUser = await createUser(prisma);
    const balanceBefore = await paidBalanceOf(inputUser.id);
    const actualResult = await service.seedAccount({ email: inputUser.email, credits: 20 });
    const actualSnapshots = await prisma.purchaseSnapshot.findMany({ where: { buyerUserId: inputUser.id, packageVersionId: { not: null } } });
    const actualEntries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: inputUser.id } });
    expect(actualResult.outcome).toBe("granted");
    expect(actualSnapshots).toHaveLength(1);
    expect(await paidBalanceOf(inputUser.id)).toBe(balanceBefore + 20);
    expect(actualEntries).toHaveLength(1);
    expect(actualEntries[0]).toMatchObject({ wallet: "paid", type: "plan_grant" });
    expect(Number(actualEntries[0].amount)).toBe(20);
  });

  it("AC1: uses the default credits of the seed file (20) when none are given", async () => {
    const inputUser = await createUser(prisma);
    await service.seedAccount({ email: inputUser.email });
    expect(await paidBalanceOf(inputUser.id)).toBe(20);
  });

  it("AC2: a second run grants nothing and says already seeded", async () => {
    const inputUser = await createUser(prisma);
    await service.seedAccount({ email: inputUser.email, credits: 20 });
    const rowsAfterFirstRun = await countRows();
    const actualSecondResult = await service.seedAccount({ email: inputUser.email, credits: 20 });
    expect(actualSecondResult.outcome).toBe("already-seeded");
    expect(await countRows()).toEqual(rowsAfterFirstRun);
    expect(await paidBalanceOf(inputUser.id)).toBe(20);
  });

  it("reuses a code left unredeemed by a failed run instead of creating it again", async () => {
    const inputUser = await createUser(prisma);
    const mockRedeem = jest.spyOn(moduleRef.get(CodesService), "redeemCode").mockRejectedValueOnce(new Error("planted failure"));
    await expect(service.seedAccount({ email: inputUser.email, credits: 20 })).rejects.toThrow("planted failure");
    mockRedeem.mockRestore();
    const actualResult = await service.seedAccount({ email: inputUser.email, credits: 20 });
    expect(actualResult.outcome).toBe("granted");
    expect(await prisma.invitationCode.count()).toBe(1);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
  });

  it("AC3: refuses with NODE_ENV=production and writes nothing", async () => {
    const inputUser = await createUser(prisma);
    const rowsBefore = await countRows();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(service.seedAccount({ email: inputUser.email, credits: 20 })).rejects.toThrow("NODE_ENV=production");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
    expect(await countRows()).toEqual(rowsBefore);
  });

  it("AC4: an unknown email throws, creates no user and writes nothing", async () => {
    await createUser(prisma);
    const rowsBefore = await countRows();
    await expect(service.seedAccount({ email: "nobody@test.local", credits: 20 })).rejects.toThrow("No account with email");
    expect(await countRows()).toEqual(rowsBefore);
    expect(await prisma.user.findUnique({ where: { email: "nobody@test.local" } })).toBeNull();
  });

  it("creates version 1 of Starter with changedBy seed:dev when no package version exists", async () => {
    const inputUser = await createUser(prisma);
    await service.seedAccount({ email: inputUser.email, credits: 20 });
    const actualVersions = await prisma.packageVersion.findMany({ include: { package: true } });
    expect(actualVersions).toHaveLength(1);
    expect(actualVersions[0]).toMatchObject({ versionNumber: 1, createdBy: "seed:dev", reason: "dev seed" });
    expect(actualVersions[0].package.name).toBe("Starter");
  });

  it("creates no package version when one already exists, and grants that one", async () => {
    const inputUser = await createUser(prisma);
    const starter = await prisma.package.findUniqueOrThrow({ where: { name: "Starter" } });
    const existingVersion = await prisma.packageVersion.create({
      data: { packageId: starter.id, versionNumber: 1, priceUsdCents: 1000, creditsGranted: 100, billing: "one_time", maxAgents: 2, maxConnectedTools: 1, apiAccess: false, allowedChannels: ["web"], allowedTiers: ["standard"], createdBy: "test", reason: "existing" },
    });
    await service.seedAccount({ email: inputUser.email, credits: 20 });
    expect(await prisma.packageVersion.count()).toBe(1);
    const actualSnapshot = await prisma.purchaseSnapshot.findFirstOrThrow({ where: { buyerUserId: inputUser.id } });
    expect(actualSnapshot.packageVersionId).toBe(existingVersion.id);
  });

  it("throws and tells the person to run bun run seed when the Starter package is missing", async () => {
    const inputUser = await createUser(prisma);
    await prisma.package.deleteMany();
    await expect(service.seedAccount({ email: inputUser.email, credits: 20 })).rejects.toThrow("bun run seed");
  });

  describe("script exit codes (spawned against the test database)", () => {
    const script = resolve(__dirname, "../../../../../../prisma/seed-dev-account.ts");
    const runScript = (args: string[], env: Record<string, string> = {}) =>
      spawnSync("bun", [script, ...args], { env: { PATH: process.env.PATH ?? "", DATABASE_URL: testDatabaseUrl(), ...env }, encoding: "utf8", cwd: resolve(__dirname, "../../../../../..") });

    it("AC3: exits 1 under NODE_ENV=production and writes nothing", async () => {
      const inputUser = await createUser(prisma);
      const actualRun = runScript([inputUser.email], { NODE_ENV: "production" });
      expect(actualRun.status).toBe(1);
      expect(await prisma.invitationCode.count()).toBe(0);
    });

    it("AC4: exits non-zero for an unknown email and creates no user", async () => {
      const actualRun = runScript(["nobody@test.local"]);
      expect(actualRun.status).not.toBe(0);
      expect(actualRun.stderr).toContain("No account with email");
      expect(await prisma.user.count()).toBe(0);
    });

    it("exits 0, grants once, and says already seeded the second time", async () => {
      const inputUser = await createUser(prisma);
      const actualFirst = runScript([inputUser.email, "7"]);
      const actualSecond = runScript([inputUser.email, "7"]);
      expect(actualFirst.status).toBe(0);
      expect(actualFirst.stdout).toContain("Granted a package and 7 credits");
      expect(actualSecond.status).toBe(0);
      expect(actualSecond.stdout).toContain("already seeded; nothing written");
      expect(await paidBalanceOf(inputUser.id)).toBe(7);
    });
  });
});
