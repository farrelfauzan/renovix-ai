import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { CodesService } from "./codes.service";
import { CodeRedemptionRepository } from "../repository/code-redemption.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPackageSnapshot, createPlan, createSubscription, createUser } from "../../../../test/factories";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../../billing/service/package-ownership.service";
import { ExchangeRateService } from "../../exchange-rates/service/exchange-rate.service";
import { OffersModule } from "../../offers/offers.module";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";

const DAY = 24 * 60 * 60 * 1000;

describe("CodesService.redeemCode (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CodesService;

  beforeAll(async () => {
    // RNX-251: OffersModule gives PurchaseSnapshotService (a package code records a snapshot).
    ({ moduleRef, prisma } = await createTestModule({ imports: [OffersModule], providers: [CodesService, CreditLedgerService, PackageOwnershipService, PlatformSettingsService] }));
    service = moduleRef.get(CodesService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await moduleRef.get(PlatformSettingsService).saveSetting({ name: "invitationGrantCredits", value: 5, author: { changedBy: "test", reason: "legacy code fixture" } });
    // RNX-251: a redemption never fetches a rate; any fetch fails loudly.
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-251 test: no network"));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** RNX-251: a listed package `name` with version 1 (these limits): what a package code names. */
  const createVersion = async (name = "Pro", limits: { maxAgents?: number; collaborationEnabled?: boolean } = {}) => {
    const pkg = await prisma.package.create({ data: { name, displayOrder: name === "Starter" ? 1 : 2, active: true, visible: true } });
    return prisma.packageVersion.create({
      data: {
        packageId: pkg.id, versionNumber: 1, priceUsdCents: 1000, creditsGranted: 100, billing: "one_time", maxAgents: limits.maxAgents ?? 5,
        maxConnectedTools: 2, apiAccess: true, allowedChannels: ["web", "whatsapp"], allowedTiers: ["standard", "advanced"],
        collaborationEnabled: limits.collaborationEnabled ?? false, createdBy: "test", reason: "RNX-251",
      },
    });
  };

  const subscriptionCode = (packageVersionId: string, code = "PERF-TEST-0001") =>
    prisma.invitationCode.create({
      data: { code, type: "subscription", packageVersionId },
    });

  /** A user with a package (RNX-251: a package snapshot): RNX-35 (D36), only such an account redeems a credits-only code. */
  const createPackageUser = async () => {
    const user = await createUser(prisma);
    await createPackageSnapshot(prisma, { userId: user.id });
    return user;
  };

  /** The user's package snapshots (RNX-251: a code grant has paymentId null). */
  const snapshotsOf = (userId: string) =>
    prisma.purchaseSnapshot.findMany({ where: { buyerUserId: userId, packageVersionId: { not: null } }, orderBy: { createdAt: "asc" } });

  const topupCode = (maxRedemptions: number, code = "PERF-TOPUP-0001") =>
    prisma.invitationCode.create({
      data: { code, type: "topup", creditAmount: 25, maxRedemptions },
    });

  /** Holds every caller at `findRedemption` (after the limit check, before the transaction) until `callers` are waiting. */
  const holdCallersAtRedemptionCheck = (callers: number) => {
    const repository = moduleRef.get(CodeRedemptionRepository);
    const findRedemption = repository.findRedemption.bind(repository);
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
    const heldFindRedemption = async (...args: Parameters<typeof findRedemption>) => {
      arrived += 1;
      if (arrived === callers) releaseAll();
      await allArrived;
      return findRedemption(...args);
    };
    jest
      .spyOn(repository, "findRedemption")
      .mockImplementation(heldFindRedemption as typeof findRedemption);
  };

  /** Runs `change` while the caller is held at `findRedemption`: after the pre-checks, before the transaction. */
  const changeCodeAfterPreChecks = (change: () => Promise<unknown>) => {
    const repository = moduleRef.get(CodeRedemptionRepository);
    const findRedemption = repository.findRedemption.bind(repository);
    const heldFindRedemption = async (...args: Parameters<typeof findRedemption>) => {
      await change();
      return findRedemption(...args);
    };
    jest
      .spyOn(repository, "findRedemption")
      .mockImplementationOnce(heldFindRedemption as typeof findRedemption);
  };

  /** The user's paid wallet balance on the credit ledger (RX-22), 0 when the user has no account yet. */
  const paidBalanceOf = async (userId: string) =>
    (await prisma.creditAccount.findUnique({ where: { userId_wallet: { userId, wallet: "paid" } } }))?.balance.toNumber() ?? 0;

  /** The number of credit ledger entries for this user (RX-22: grants are ledger entries, no Transaction rows). */
  const ledgerEntryCount = (userId: string) => prisma.creditLedgerEntry.count({ where: { memberUserId: userId } });

  /** What a redemption of this code could have given this user, read back from the database. */
  const grantsOf = async (userId: string, codeId: string) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { subscription: true },
    });
    const code = await prisma.invitationCode.findUniqueOrThrow({ where: { id: codeId } });
    return {
      balance: await paidBalanceOf(userId),
      ledgerRows: await ledgerEntryCount(userId),
      subscription: user.subscription,
      snapshots: await prisma.purchaseSnapshot.count({ where: { buyerUserId: userId } }),
      redemptions: await prisma.codeRedemption.count({ where: { codeId, userId } }),
      timesRedeemed: code.timesRedeemed,
    };
  };

  /** The user's paid wallet balance and the sum of the user's ledger entries (RX-22: was User.balance and top-up rows). */
  const balanceAndLedger = async (userId: string) => {
    const ledger = await prisma.creditLedgerEntry.aggregate({ where: { memberUserId: userId }, _sum: { amount: true } });
    return { balance: await paidBalanceOf(userId), ledgerSum: ledger._sum.amount?.toNumber() ?? 0 };
  };

  it("RX-22: a redeemed code grants into the credit ledger (credits-only code: bonus; package code: plan_grant)", async () => {
    const user = await createPackageUser();
    const version = await createVersion("Pro");
    const topup = await topupCode(1);
    const both = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0009", type: "both", creditAmount: 10, packageVersionId: version.id },
    });

    await service.redeemCode(user.id, topup.code);
    await service.redeemCode(user.id, both.code);

    const redemptions = await prisma.codeRedemption.findMany({ where: { userId: user.id } });
    const redemptionOf = (codeId: string) => redemptions.find((r) => r.codeId === codeId)!.id;
    const entries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: user.id }, orderBy: { seq: "asc" } });
    expect(entries.map((e) => [e.seq, e.type, e.amount.toFixed(6), e.balanceAfter.toFixed(6), e.reference, e.wallet])).toEqual([
      [1, "bonus", "25.000000", "25.000000", redemptionOf(topup.id), "paid"],
      [2, "plan_grant", "10.000000", "35.000000", redemptionOf(both.id), "paid"],
    ]);
    expect(await paidBalanceOf(user.id)).toBe(35);
    await assertCreditLedgerInvariants(prisma);
  });

  it("RNX-172: a credit-bearing code with no stored amount uses the invitationGrantCredits setting", async () => {
    const user = await createPackageUser();
    await moduleRef.get(PlatformSettingsService).saveSetting({
      name: "invitationGrantCredits",
      value: 7,
      author: { changedBy: "test", reason: "RNX-172" },
    });
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-SETTING-0001", type: "topup", creditAmount: null, maxRedemptions: 1 },
    });

    await expect(service.redeemCode(user.id, code.code)).resolves.toMatchObject({ creditsGranted: 7 });
    expect((await prisma.creditLedgerEntry.findFirst({ where: { memberUserId: user.id } }))?.amount.toString()).toBe("7");
  });

  it("RNX-172 regression: a subscription code carrying metadata creditAmount grants no bonus", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const code = await prisma.invitationCode.create({
      data: {
        code: "PERF-SUB-CREDIT-0001",
        type: "subscription",
        packageVersionId: version.id,
        creditAmount: 100,
        maxRedemptions: 1,
      },
    });

    await expect(service.redeemCode(user.id, code.code)).resolves.toMatchObject({
      creditsGranted: null,
      planGranted: "Pro",
    });
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  });

  it.each(["topup", "both"] as const)("RNX-172 control: a %s code with null creditAmount uses the setting", async (type) => {
    const user = await createPackageUser();
    const version = type === "both" ? await createVersion("Pro") : null;
    const code = await prisma.invitationCode.create({
      data: { code: `PERF-NULL-${type}`, type, creditAmount: null, maxRedemptions: 1, packageVersionId: version?.id ?? null },
    });

    await expect(service.redeemCode(user.id, code.code)).resolves.toMatchObject({ creditsGranted: 5 });
    expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id } })).toBe(1);
  });

  it("RNX-172 control: a topup code with zero creditAmount grants no credit", async () => {
    const user = await createPackageUser();
    const code = await prisma.invitationCode.create({ data: { code: "PERF-ZERO-TOPUP", type: "topup", creditAmount: 0, maxRedemptions: 1 } });

    await expect(service.redeemCode(user.id, code.code)).resolves.toMatchObject({ creditsGranted: null });
    expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id } })).toBe(0);
  });

  it("RNX-172: a missing invitation grant setting refuses before redemption/ledger write", async () => {
    const user = await createPackageUser();
    await prisma.platformSetting.delete({ where: { name: "invitationGrantCredits" } });
    const code = await prisma.invitationCode.create({ data: { code: "PERF-SETTING-0002", type: "topup", creditAmount: null, maxRedemptions: 1 } });

    await expect(service.redeemCode(user.id, code.code)).rejects.toThrow(/invitationGrantCredits/);
    expect(await prisma.codeRedemption.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  });

  // RNX-35 (D36): no credits-only state; a free account (no subscription, no bought package) cannot redeem a credits-only code.
  it("RNX-35 (D36): a free account redeeming a credits-only code is refused with 403; nothing is granted or used up", async () => {
    const user = await createUser(prisma);
    const code = await topupCode(3);

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toBeInstanceOf(ForbiddenException);
    await expect(redeem).rejects.toThrow("A credits-only code can be redeemed only by an account with a package");
    expect(await grantsOf(user.id, code.id)).toEqual({ balance: 0, ledgerRows: 0, subscription: null, snapshots: 0, redemptions: 0, timesRedeemed: 0 });
  });

  it("RNX-35 (D36): an account with a bought package (a package purchase snapshot, no subscription) may redeem a credits-only code", async () => {
    const user = await createUser(prisma);
    const pkg = await prisma.package.create({ data: { name: "Starter-d36", displayOrder: 1, active: true, visible: true } });
    const version = await prisma.packageVersion.create({
      data: { packageId: pkg.id, versionNumber: 1, priceUsdCents: 1000, creditsGranted: 10, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: false, allowedChannels: [], allowedTiers: [], createdBy: "test", reason: "test" },
    });
    await prisma.purchaseSnapshot.create({
      data: { buyerUserId: user.id, packageVersionId: version.id, priceUsdCents: 1000, exchangeRate: "16500", exchangeRateDate: new Date("2026-10-21"), exchangeRateSource: "test", priceRupiah: 165000, creditsGranted: 10, allowedChannels: [], allowedTiers: [] },
    });
    const code = await topupCode(3);

    await expect(service.redeemCode(user.id, code.code)).resolves.toMatchObject({ success: true, creditsGranted: 25 });
  });

  // D186: a code that grants 0 credits (e.g. a package code that only unlocks) writes no ledger entry; the
  // redemption itself still succeeds.
  it("RX-22: a code with 0 credits is redeemed but writes no ledger entry", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const zero = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0010", type: "both", creditAmount: 0, packageVersionId: version.id },
    });

    await service.redeemCode(user.id, zero.code);

    expect(await prisma.codeRedemption.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id } })).toBe(0);
    expect(await prisma.creditAccount.count({ where: { userId: user.id } })).toBe(0);
  });

  it("RX-147: lets two users redeem a multi-use credit code, one ledger row each", async () => {
    const [userA, userB] = [await createUser(prisma), await createUser(prisma)];
    const version = await createVersion("Pro");
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0003", type: "both", creditAmount: 25, packageVersionId: version.id, maxRedemptions: 3 },
    });

    await service.redeemCode(userA.id, code.code);
    const resB = await service.redeemCode(userB.id, code.code);

    expect(resB).toMatchObject({ success: true, creditsGranted: 25, planGranted: "Pro" });
    for (const user of [userA, userB]) {
      expect(await balanceAndLedger(user.id)).toEqual({ balance: 25, ledgerSum: 25 });
      expect(await ledgerEntryCount(user.id)).toBe(1);
    }
  });

  it("RX-147: refuses a user's second redemption of a code with uses left and changes nothing", async () => {
    const user = await createPackageUser();
    const code = await topupCode(3);
    await service.redeemCode(user.id, code.code);

    await expect(service.redeemCode(user.id, code.code)).rejects.toBeInstanceOf(ConflictException);

    expect(await balanceAndLedger(user.id)).toEqual({ balance: 25, ledgerSum: 25 });
    expect(await ledgerEntryCount(user.id)).toBe(1);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 1,
    });
  });

  it("RX-147: refuses a second user on a single-use code with the maximum-redemptions 400", async () => {
    const [userA, userB] = [await createPackageUser(), await createPackageUser()];
    const code = await topupCode(1);
    await service.redeemCode(userA.id, code.code);

    const redeemB = service.redeemCode(userB.id, code.code);

    await expect(redeemB).rejects.toBeInstanceOf(BadRequestException);
    await expect(redeemB).rejects.toThrow("maximum number of redemptions");
    expect(await balanceAndLedger(userB.id)).toEqual({ balance: 0, ledgerSum: 0 });
  });

  it("RX-147: keeps a fresh user's balance equal to the sum of the user's ledger rows after each redemption", async () => {
    const user = await createPackageUser();
    const first = await topupCode(5, "PERF-TOPUP-0001");
    const second = await topupCode(5, "PERF-TOPUP-0002");

    await service.redeemCode(user.id, first.code);
    expect(await balanceAndLedger(user.id)).toEqual({ balance: 25, ledgerSum: 25 });
    await service.redeemCode(user.id, second.code);
    expect(await balanceAndLedger(user.id)).toEqual({ balance: 50, ledgerSum: 50 });
  });

  it("RX-147: grants a two-use code to exactly two of three users redeeming at the same moment", async () => {
    const users = [await createPackageUser(), await createPackageUser(), await createPackageUser()];
    const code = await topupCode(2);
    holdCallersAtRedemptionCheck(users.length);

    const results = await Promise.allSettled(users.map((u) => service.redeemCode(u.id, code.code)));

    const refused = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 2,
    });
    expect(await prisma.codeRedemption.count()).toBe(2);
    expect(await prisma.creditLedgerEntry.count()).toBe(2);
    const balances = await Promise.all(users.map((u) => balanceAndLedger(u.id)));
    expect(balances.map((b) => b.balance).sort()).toEqual([0, 25, 25]);
    balances.forEach((b) => expect(b.balance).toBe(b.ledgerSum));
  });

  it("RX-147: grants once when the same user redeems one code twice at the same moment (201 and 409, never 500)", async () => {
    const user = await createPackageUser();
    const code = await topupCode(3);
    holdCallersAtRedemptionCheck(2);

    const results = await Promise.allSettled([
      service.redeemCode(user.id, code.code),
      service.redeemCode(user.id, code.code),
    ]);

    const refused = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(await prisma.codeRedemption.count({ where: { userId: user.id } })).toBe(1);
    expect(await ledgerEntryCount(user.id)).toBe(1);
    expect(await balanceAndLedger(user.id)).toEqual({ balance: 25, ledgerSum: 25 });
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 1,
    });
  });

  it("RX-181: refuses a code deactivated after the pre-checks with the deactivated 400 and grants nothing", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0181", type: "both", creditAmount: 25, packageVersionId: version.id, maxRedemptions: 3 },
    });
    changeCodeAfterPreChecks(() => prisma.invitationCode.update({ where: { id: code.id }, data: { isActive: false } }));

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toBeInstanceOf(BadRequestException);
    await expect(redeem).rejects.toThrow("This code has been deactivated");
    expect(await grantsOf(user.id, code.id)).toEqual({
      balance: 0,
      ledgerRows: 0,
      subscription: null,
      snapshots: 0,
      redemptions: 0,
      timesRedeemed: 0,
    });
  });

  it("RX-181: refuses a code that expired after the pre-checks with the expired 400 and grants nothing", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0182", type: "both", creditAmount: 25, packageVersionId: version.id, maxRedemptions: 3 },
    });
    changeCodeAfterPreChecks(() =>
      prisma.invitationCode.update({ where: { id: code.id }, data: { expiresAt: new Date(Date.now() - DAY) } }),
    );

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toBeInstanceOf(BadRequestException);
    await expect(redeem).rejects.toThrow("This code has expired");
    expect(await grantsOf(user.id, code.id)).toEqual({
      balance: 0,
      ledgerRows: 0,
      subscription: null,
      snapshots: 0,
      redemptions: 0,
      timesRedeemed: 0,
    });
  });

  it("RX-181: refuses a code deactivated or expired before the request with the same 400s as before", async () => {
    const user = await createUser(prisma);
    await prisma.invitationCode.create({
      data: { code: "PERF-OFFF-0181", type: "topup", creditAmount: 25, maxRedemptions: 3, isActive: false },
    });
    await prisma.invitationCode.create({
      data: { code: "PERF-OLDD-0181", type: "topup", creditAmount: 25, maxRedemptions: 3, expiresAt: new Date(Date.now() - DAY) },
    });

    const deactivated = service.redeemCode(user.id, "PERF-OFFF-0181");
    const expired = service.redeemCode(user.id, "PERF-OLDD-0181");

    await expect(deactivated).rejects.toBeInstanceOf(BadRequestException);
    await expect(deactivated).rejects.toThrow("This code has been deactivated");
    await expect(expired).rejects.toBeInstanceOf(BadRequestException);
    await expect(expired).rejects.toThrow("This code has expired");
    expect(await balanceAndLedger(user.id)).toEqual({ balance: 0, ledgerSum: 0 });
  });

  // RNX-251 AC (c): the RX-181 claim serializes redemptions of one code; one account redeeming one package code twice
  // at the same moment gets one snapshot and one 409.
  it("RNX-251: one account redeeming the same package code twice at the same moment: exactly one snapshot, the other 409", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-SUBS-0181", type: "subscription", packageVersionId: version.id, maxRedemptions: 3 },
    });
    holdCallersAtRedemptionCheck(2);

    const results = await Promise.allSettled([
      service.redeemCode(user.id, code.code),
      service.redeemCode(user.id, code.code),
    ]);

    const refused = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(await snapshotsOf(user.id)).toHaveLength(1);
    expect(await grantsOf(user.id, code.id)).toMatchObject({ subscription: null, snapshots: 1, redemptions: 1, timesRedeemed: 1 });
  });

  // RNX-251 AC (c): two different package codes are two claims on two rows, so both go through: each code is redeemed
  // once and the account gets two snapshots (fine: the entitlement aggregates them).
  it("RNX-251: one account redeeming two different package codes at the same moment: each code once, two snapshots", async () => {
    const user = await createUser(prisma);
    const [starter, pro] = [await createVersion("Starter"), await createVersion("Pro")];
    const first = await subscriptionCode(starter.id, "PERF-SUBS-0182");
    const second = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0183", type: "both", creditAmount: 25, packageVersionId: pro.id },
    });
    holdCallersAtRedemptionCheck(2);

    const results = await Promise.allSettled([
      service.redeemCode(user.id, first.code),
      service.redeemCode(user.id, second.code),
    ]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect((await snapshotsOf(user.id)).map((row) => row.packageVersionId).sort()).toEqual([starter.id, pro.id].sort());
    expect(await grantsOf(user.id, first.id)).toMatchObject({ subscription: null, redemptions: 1, timesRedeemed: 1 });
    expect(await grantsOf(user.id, second.id)).toMatchObject({ balance: 25, ledgerRows: 1, redemptions: 1, timesRedeemed: 1 });
    expect(await moduleRef.get(EntitlementService).getForUser(user.id)).toMatchObject({ packageName: "Pro" });
  });

  // RNX-251 AC (a): a package code records a purchase snapshot of its version (a code grant: paymentId null, price 0,
  // no credits of its own), never a user_subscriptions row.
  it("RNX-251: a package code grants its version as a purchase snapshot (paymentId null, price 0, no credits); no subscription", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro", { maxAgents: 7, collaborationEnabled: true });
    const code = await subscriptionCode(version.id);

    const actualResponse = await service.redeemCode(user.id, code.code);

    expect(actualResponse).toEqual({ success: true, creditsGranted: null, planGranted: "Pro", daysGranted: null });
    const [actualSnapshot, ...others] = await snapshotsOf(user.id);
    expect(others).toEqual([]);
    expect(actualSnapshot).toMatchObject({
      packageVersionId: version.id, topUpPackVersionId: null, paymentId: null, priceUsdCents: 0, priceRupiah: 0,
      billing: "one_time", maxAgents: 7, maxConnectedTools: 2, apiAccess: true, collaborationEnabled: true,
      allowedChannels: ["web", "whatsapp"], allowedTiers: ["standard", "advanced"],
    });
    expect(actualSnapshot.creditsGranted.toString()).toBe("0");
    expect(await moduleRef.get(EntitlementService).getForUser(user.id)).toMatchObject({
      packageVersionId: version.id, packageName: "Pro", maxAgents: 7, maxConnectedTools: 2, apiAccess: true,
      collaborationEnabled: true, allowedChannels: ["web", "whatsapp"],
    });
    expect(await prisma.userSubscription.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.codeRedemption.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ planGranted: "Pro", daysGranted: null });
    expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id } })).toBe(0);
    expect(await prisma.invitationCode.findUnique({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 1,
    });
  });

  it("RNX-251: a \"both\" code records the snapshot (no credits on it) and grants its credits through the ledger (plan_grant)", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Starter");
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0251", type: "both", creditAmount: 25, packageVersionId: version.id },
    });

    const actualResponse = await service.redeemCode(user.id, code.code);

    expect(actualResponse).toEqual({ success: true, creditsGranted: 25, planGranted: "Starter", daysGranted: null });
    const [actualSnapshot] = await snapshotsOf(user.id);
    expect(actualSnapshot).toMatchObject({ packageVersionId: version.id, paymentId: null, priceUsdCents: 0, priceRupiah: 0 });
    expect(actualSnapshot.creditsGranted.toString()).toBe("0");
    const redemption = await prisma.codeRedemption.findFirstOrThrow({ where: { userId: user.id } });
    const entries = await prisma.creditLedgerEntry.findMany({ where: { memberUserId: user.id } });
    expect(entries.map((e) => [e.type, e.amount.toFixed(6), e.reference, e.wallet])).toEqual([["plan_grant", "25.000000", redemption.id, "paid"]]);
    expect(await prisma.userSubscription.count({ where: { userId: user.id } })).toBe(0);
    await assertCreditLedgerInvariants(prisma);
  });

  // RNX-251 AC (b): the rate on a code grant is only a record (the price is 0): the latest stored rate, never a live
  // fetch, so a redemption is never refused for want of a current rate.
  it("RNX-251: with only a stale stored rate (a purchase would refresh or refuse), the grant uses that rate and never fetches", async () => {
    const user = await createUser(prisma);
    const code = await subscriptionCode((await createVersion("Pro")).id);
    const staleDate = new Date(Date.now() - 60 * DAY);
    await prisma.exchangeRate.create({ data: { base: "USD", quote: "IDR", rate: "15900", rateDate: new Date(staleDate.toISOString().slice(0, 10)), fetchedAt: staleDate, source: "frankfurter" } });
    const mockGetPurchaseRate = jest.spyOn(ExchangeRateService.prototype, "getPurchaseRate");
    const mockRefreshRate = jest.spyOn(ExchangeRateService.prototype, "refreshRate");

    await expect(service.redeemCode(user.id, code.code)).resolves.toMatchObject({ success: true, planGranted: "Pro" });

    const [actualSnapshot] = await snapshotsOf(user.id);
    expect(actualSnapshot.exchangeRate.toString()).toBe("15900");
    expect(actualSnapshot.exchangeRateSource).toBe("frankfurter");
    expect(actualSnapshot.exchangeRateDate.toISOString().slice(0, 10)).toBe(staleDate.toISOString().slice(0, 10));
    expect(mockGetPurchaseRate).not.toHaveBeenCalled();
    expect(mockRefreshRate).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("RNX-251: with no stored rate at all, the grant records rate 0 dated today from source \"none\"; nothing is fetched", async () => {
    const user = await createUser(prisma);
    const code = await subscriptionCode((await createVersion("Pro")).id);
    const mockGetPurchaseRate = jest.spyOn(ExchangeRateService.prototype, "getPurchaseRate");

    await expect(service.redeemCode(user.id, code.code)).resolves.toMatchObject({ success: true, planGranted: "Pro" });

    const [actualSnapshot] = await snapshotsOf(user.id);
    expect(actualSnapshot.exchangeRate.toString()).toBe("0");
    expect(actualSnapshot.exchangeRateSource).toBe("none");
    expect(actualSnapshot.exchangeRateDate.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect(mockGetPurchaseRate).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // RNX-251 AC (h): PackageOwnershipService reads snapshots only: a code-granted package lets a credits-only code redeem.
  it("RNX-251: a code-granted package counts as a package: a credits-only code then redeems", async () => {
    const user = await createUser(prisma);
    const packageCode = await subscriptionCode((await createVersion("Starter")).id);
    const topup = await topupCode(1);
    await expect(service.redeemCode(user.id, topup.code)).rejects.toBeInstanceOf(ForbiddenException);

    await service.redeemCode(user.id, packageCode.code);
    const actualResponse = await service.redeemCode(user.id, topup.code);

    expect(await moduleRef.get(PackageOwnershipService).hasPackage(user.id)).toBe(true);
    expect(actualResponse).toMatchObject({ success: true, creditsGranted: 25 });
    expect(await paidBalanceOf(user.id)).toBe(25);
  });

  it("RNX-251: an active user_subscriptions row alone is no package any more: a credits-only code is refused (403)", async () => {
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: (await createPlan(prisma)).id, status: "active" });
    const topup = await topupCode(1);

    await expect(service.redeemCode(user.id, topup.code)).rejects.toThrow("A credits-only code can be redeemed only by an account with a package");
    expect(await moduleRef.get(PackageOwnershipService).hasPackage(user.id)).toBe(false);
  });

  // RNX-251: was "moves an existing active subscription to the new plan and extends it"; a package is permanent (D37),
  // so a second package code adds a second snapshot and the entitlement shows the higher package.
  it("a package code for an account that already has a package adds a snapshot; the earlier one stays", async () => {
    const user = await createUser(prisma);
    const starter = await createVersion("Starter");
    const pro = await createVersion("Pro");
    await service.redeemCode(user.id, (await subscriptionCode(starter.id, "PERF-STRT-0001")).code);

    await service.redeemCode(user.id, (await subscriptionCode(pro.id, "PERF-PROO-0001")).code);

    expect((await snapshotsOf(user.id)).map((row) => row.packageVersionId)).toEqual([starter.id, pro.id]);
    expect(await moduleRef.get(EntitlementService).getForUser(user.id)).toMatchObject({ packageName: "Pro" });
  });

  it("refuses a second redemption by the same user and grants nothing more", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const code = await subscriptionCode(version.id);
    await prisma.invitationCode.update({ where: { id: code.id }, data: { maxRedemptions: 5 } });
    await service.redeemCode(user.id, code.code);

    await expect(service.redeemCode(user.id, code.code)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.codeRedemption.count()).toBe(1);
    expect(await snapshotsOf(user.id)).toHaveLength(1);
  });

  // RX-22: the ledger grant is now the last step (it needs the redemption id), so it is the one that fails here.
  it("rolls back every earlier step of a redemption when a later step fails", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0001", type: "both", creditAmount: 25, packageVersionId: version.id },
    });
    jest
      .spyOn(moduleRef.get(CreditLedgerService), "appendEntry")
      .mockRejectedValueOnce(new Error("the ledger entry cannot be written"));

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toThrow("the ledger entry cannot be written");
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { subscription: true, codeRedemptions: true },
    });
    expect(await paidBalanceOf(user.id)).toBe(0);
    expect(await ledgerEntryCount(user.id)).toBe(0);
    expect(after.subscription).toBeNull();
    expect(await snapshotsOf(user.id)).toEqual([]);
    expect(after.codeRedemptions).toEqual([]);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 0,
    });
  });

  it("RX-22 review NIT 6: rolls back everything when the redemption row itself cannot be written (no ledger entry, no package)", async () => {
    const user = await createUser(prisma);
    const version = await createVersion("Pro");
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0002", type: "both", creditAmount: 25, packageVersionId: version.id },
    });
    jest
      .spyOn(moduleRef.get(CodeRedemptionRepository), "createRedemption")
      .mockRejectedValueOnce(new Error("the redemption row cannot be written"));

    await expect(service.redeemCode(user.id, code.code)).rejects.toThrow("the redemption row cannot be written");

    expect(await paidBalanceOf(user.id)).toBe(0);
    expect(await ledgerEntryCount(user.id)).toBe(0);
    expect(await prisma.creditAccount.count()).toBe(0);
    expect(await prisma.userSubscription.count({ where: { userId: user.id } })).toBe(0);
    expect(await snapshotsOf(user.id)).toEqual([]);
    expect(await prisma.codeRedemption.count()).toBe(0);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({ timesRedeemed: 0 });
  });

  // RNX-251: was "leaves an existing subscription as it was when a later step of the redemption fails".
  it("leaves an existing package as it was when a later step of the redemption fails", async () => {
    const user = await createUser(prisma);
    const before = await createPackageSnapshot(prisma, { userId: user.id });
    const code = await subscriptionCode((await createVersion("Pro")).id);
    jest
      .spyOn(moduleRef.get(CodeRedemptionRepository), "createRedemption")
      .mockRejectedValueOnce(new Error("the redemption row cannot be written"));

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toThrow("the redemption row cannot be written");
    expect((await snapshotsOf(user.id)).map((row) => row.id)).toEqual([before.id]);
  });
});
