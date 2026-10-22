import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { CodesService } from "./codes.service";
import { CodeRedemptionRepository } from "../repository/code-redemption.repository";
import { UserSubscriptionRepository } from "../../billing/repository/user-subscription.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPlan, createSubscription, createUser } from "../../../../test/factories";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../../billing/service/package-ownership.service";

const DAY = 24 * 60 * 60 * 1000;

describe("CodesService.redeemCode (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CodesService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CodesService, CreditLedgerService, PackageOwnershipService] }));
    service = moduleRef.get(CodesService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  const subscriptionCode = (planId: string, code = "PERF-TEST-0001") =>
    prisma.invitationCode.create({
      data: { code, type: "subscription", planId, durationDays: 30 },
    });

  /** A user with a package (an active subscription): RNX-35 (D36), only such an account redeems a credits-only code. */
  const createPackageUser = async () => {
    const user = await createUser(prisma);
    await createSubscription(prisma, { userId: user.id, planId: (await createPlan(prisma)).id });
    return user;
  };

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

  /** Holds every caller right after it read the user's subscription (inside its transaction) until `callers` have read it. */
  const holdCallersAfterSubscriptionRead = (callers: number) => {
    const repository = moduleRef.get(UserSubscriptionRepository);
    const findSubscription = repository.findSubscriptionByUserId.bind(repository);
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
    const heldFindSubscription = async (...args: Parameters<typeof findSubscription>) => {
      const subscription = await findSubscription(...args);
      arrived += 1;
      if (arrived === callers) releaseAll();
      await allArrived;
      return subscription;
    };
    jest
      .spyOn(repository, "findSubscriptionByUserId")
      .mockImplementation(heldFindSubscription as typeof findSubscription);
  };

  /**
   * Holds both callers at `createSubscription` (each has read no subscription, neither has written) until both are
   * waiting, then lets the caller granting `firstPlanId` write first and the other once that write has returned.
   */
  const holdSubscriptionCreates = (firstPlanId: string) => {
    const repository = moduleRef.get(UserSubscriptionRepository);
    const createSubscription = repository.createSubscription.bind(repository);
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
    let firstWritten!: () => void;
    const firstWrite = new Promise<void>((resolve) => (firstWritten = resolve));
    const heldCreateSubscription = async (...args: Parameters<typeof createSubscription>) => {
      arrived += 1;
      if (arrived === 2) releaseAll();
      await allArrived;
      if (args[1].planId !== firstPlanId) {
        await firstWrite;
        return createSubscription(...args);
      }
      try {
        return await createSubscription(...args);
      } finally {
        firstWritten();
      }
    };
    jest
      .spyOn(repository, "createSubscription")
      .mockImplementation(heldCreateSubscription as typeof createSubscription);
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
    const plan = await createPlan(prisma, { slug: "pro" });
    const topup = await topupCode(1);
    const both = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0009", type: "both", creditAmount: 10, planId: plan.id, durationDays: 30 },
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

  // RNX-35 (D36): no credits-only state; a free account (no subscription, no bought package) cannot redeem a credits-only code.
  it("RNX-35 (D36): a free account redeeming a credits-only code is refused with 403; nothing is granted or used up", async () => {
    const user = await createUser(prisma);
    const code = await topupCode(3);

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toBeInstanceOf(ForbiddenException);
    await expect(redeem).rejects.toThrow("A credits-only code can be redeemed only by an account with a package");
    expect(await grantsOf(user.id, code.id)).toEqual({ balance: 0, ledgerRows: 0, subscription: null, redemptions: 0, timesRedeemed: 0 });
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
    const plan = await createPlan(prisma, { slug: "pro" });
    const zero = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0010", type: "both", creditAmount: 0, planId: plan.id, durationDays: 30 },
    });

    await service.redeemCode(user.id, zero.code);

    expect(await prisma.codeRedemption.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.creditLedgerEntry.count({ where: { memberUserId: user.id } })).toBe(0);
    expect(await prisma.creditAccount.count({ where: { userId: user.id } })).toBe(0);
  });

  it("RX-147: lets two users redeem a multi-use credit code, one ledger row each", async () => {
    const [userA, userB] = [await createUser(prisma), await createUser(prisma)];
    const plan = await createPlan(prisma, { slug: "pro" });
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0003", type: "both", creditAmount: 25, planId: plan.id, durationDays: 30, maxRedemptions: 3 },
    });

    await service.redeemCode(userA.id, code.code);
    const resB = await service.redeemCode(userB.id, code.code);

    expect(resB).toMatchObject({ success: true, creditsGranted: 25, planGranted: "pro" });
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
    const plan = await createPlan(prisma);
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0181", type: "both", creditAmount: 25, planId: plan.id, durationDays: 30, maxRedemptions: 3 },
    });
    changeCodeAfterPreChecks(() => prisma.invitationCode.update({ where: { id: code.id }, data: { isActive: false } }));

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toBeInstanceOf(BadRequestException);
    await expect(redeem).rejects.toThrow("This code has been deactivated");
    expect(await grantsOf(user.id, code.id)).toEqual({
      balance: 0,
      ledgerRows: 0,
      subscription: null,
      redemptions: 0,
      timesRedeemed: 0,
    });
  });

  it("RX-181: refuses a code that expired after the pre-checks with the expired 400 and grants nothing", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0182", type: "both", creditAmount: 25, planId: plan.id, durationDays: 30, maxRedemptions: 3 },
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

  it("RX-181: a user with no subscription redeeming two plan codes at once gets one 201 and one 409, never 500; the refused code is not used up and can be redeemed later", async () => {
    const user = await createUser(prisma);
    const starter = await createPlan(prisma, { slug: "starter" });
    const pro = await createPlan(prisma, { slug: "pro" });
    const first = await prisma.invitationCode.create({
      data: { code: "PERF-SUBS-0181", type: "subscription", planId: starter.id, durationDays: 30 },
    });
    const refused = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0183", type: "both", creditAmount: 25, planId: pro.id, durationDays: 45 },
    });
    holdSubscriptionCreates(starter.id);

    const results = await Promise.allSettled([
      service.redeemCode(user.id, first.code),
      service.redeemCode(user.id, refused.code),
    ]);

    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(await prisma.userSubscription.count({ where: { userId: user.id } })).toBe(1);
    const subscription = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(subscription.planId).toBe(starter.id);
    expect(await grantsOf(user.id, refused.id)).toMatchObject({
      balance: 0,
      ledgerRows: 0,
      redemptions: 0,
      timesRedeemed: 0,
    });
    const again = await service.redeemCode(user.id, refused.code);
    expect(again).toMatchObject({ success: true, creditsGranted: 25, planGranted: "pro", daysGranted: 45 });
    const after = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.currentPeriodEnd.getTime()).toBe(subscription.currentPeriodEnd.getTime() + 45 * DAY);
    expect(await grantsOf(user.id, refused.id)).toMatchObject({ balance: 25, ledgerRows: 1, redemptions: 1, timesRedeemed: 1 });
  });

  it("RX-181: a user with an active subscription redeeming two plan codes at once gets one 201 and one 409; the end moves by the granted code's days; the refused code can be redeemed later", async () => {
    const user = await createUser(prisma);
    const basic = await createPlan(prisma, { slug: "basic" });
    const before = await createSubscription(prisma, { userId: user.id, planId: basic.id, status: "active" });
    const codes = [
      await prisma.invitationCode.create({
        data: { code: "PERF-SUBS-0182", type: "subscription", planId: basic.id, durationDays: 30 },
      }),
      await prisma.invitationCode.create({
        data: { code: "PERF-SUBS-0183", type: "subscription", planId: basic.id, durationDays: 45 },
      }),
    ];
    holdCallersAfterSubscriptionRead(2);

    const results = await Promise.allSettled(codes.map((c) => service.redeemCode(user.id, c.code)));

    const grantedIndex = results.findIndex((r) => r.status === "fulfilled");
    const refusedIndex = results.findIndex((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refusedIndex).not.toBe(-1);
    expect((results[refusedIndex] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    const [granted, refused] = [codes[grantedIndex], codes[refusedIndex]];
    const after = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.currentPeriodEnd.getTime()).toBe(before.currentPeriodEnd.getTime() + (granted.durationDays ?? 0) * DAY);
    expect(await grantsOf(user.id, refused.id)).toMatchObject({ redemptions: 0, timesRedeemed: 0 });
    const again = await service.redeemCode(user.id, refused.code);
    expect(again).toMatchObject({ success: true, daysGranted: refused.durationDays });
    const last = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(last.currentPeriodEnd.getTime()).toBe(before.currentPeriodEnd.getTime() + (30 + 45) * DAY);
    expect(await grantsOf(user.id, refused.id)).toMatchObject({ redemptions: 1, timesRedeemed: 1 });
  });

  it("grants the code's plan as an active subscription", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, { slug: "pro" });
    const code = await subscriptionCode(plan.id);

    const res = await service.redeemCode(user.id, code.code);

    expect(res).toEqual({ success: true, creditsGranted: null, planGranted: "pro", daysGranted: 30 });
    const sub = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(sub).toMatchObject({ planId: plan.id, status: "active" });
    expect(sub.currentPeriodEnd.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    expect(await prisma.invitationCode.findUnique({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 1,
    });
  });

  it("moves an existing active subscription to the new plan and extends it", async () => {
    const user = await createUser(prisma);
    const starter = await createPlan(prisma, { slug: "starter" });
    const pro = await createPlan(prisma, { slug: "pro" });
    const before = await createSubscription(prisma, { userId: user.id, planId: starter.id });
    const code = await subscriptionCode(pro.id);

    await service.redeemCode(user.id, code.code);

    const after = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.planId).toBe(pro.id);
    expect(after.currentPeriodEnd.getTime()).toBe(before.currentPeriodEnd.getTime() + 30 * DAY);
  });

  it("RX-181: extends a subscription whose stored end has microseconds (a row this API did not write)", async () => {
    const user = await createUser(prisma);
    const starter = await createPlan(prisma, { slug: "starter" });
    const pro = await createPlan(prisma, { slug: "pro" });
    await createSubscription(prisma, { userId: user.id, planId: starter.id });
    await prisma.$executeRaw`UPDATE user_subscriptions SET current_period_end = current_period_end + interval '123 microseconds' WHERE user_id = ${user.id}`;
    const before = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    const code = await subscriptionCode(pro.id);

    await service.redeemCode(user.id, code.code);

    const after = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.planId).toBe(pro.id);
    expect(after.currentPeriodEnd.getTime()).toBe(before.currentPeriodEnd.getTime() + 30 * DAY);
  });

  it("refuses a second redemption by the same user and grants nothing more", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    const code = await subscriptionCode(plan.id);
    await prisma.invitationCode.update({ where: { id: code.id }, data: { maxRedemptions: 5 } });
    await service.redeemCode(user.id, code.code);

    await expect(service.redeemCode(user.id, code.code)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.codeRedemption.count()).toBe(1);
  });

  // RX-22: the ledger grant is now the last step (it needs the redemption id), so it is the one that fails here.
  it("rolls back every earlier step of a redemption when a later step fails", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, { slug: "pro" });
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0001", type: "both", creditAmount: 25, planId: plan.id, durationDays: 30 },
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
    expect(after.codeRedemptions).toEqual([]);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 0,
    });
  });

  it("RX-22 review NIT 6: rolls back everything when the redemption row itself cannot be written (no ledger entry, no plan)", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, { slug: "pro" });
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0002", type: "both", creditAmount: 25, planId: plan.id, durationDays: 30 },
    });
    jest
      .spyOn(moduleRef.get(CodeRedemptionRepository), "createRedemption")
      .mockRejectedValueOnce(new Error("the redemption row cannot be written"));

    await expect(service.redeemCode(user.id, code.code)).rejects.toThrow("the redemption row cannot be written");

    expect(await paidBalanceOf(user.id)).toBe(0);
    expect(await ledgerEntryCount(user.id)).toBe(0);
    expect(await prisma.creditAccount.count()).toBe(0);
    expect(await prisma.userSubscription.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.codeRedemption.count()).toBe(0);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({ timesRedeemed: 0 });
  });

  it("leaves an existing subscription as it was when a later step of the redemption fails", async () => {
    const user = await createUser(prisma);
    const basic = await createPlan(prisma, { slug: "basic" });
    const pro = await createPlan(prisma, { slug: "pro" });
    const before = await createSubscription(prisma, { userId: user.id, planId: basic.id, status: "active" });
    const code = await subscriptionCode(pro.id);
    jest
      .spyOn(moduleRef.get(CodeRedemptionRepository), "createRedemption")
      .mockRejectedValueOnce(new Error("the redemption row cannot be written"));

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toThrow("the redemption row cannot be written");
    const after = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after).toMatchObject({
      planId: basic.id,
      currentPeriodEnd: before.currentPeriodEnd,
    });
  });
});
