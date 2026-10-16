import { BadRequestException, ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { CodesService } from "./codes.service";
import { CodeRedemptionRepository } from "../repository/code-redemption.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createPlan, createSubscription, createUser } from "../../../../test/factories";

const DAY = 24 * 60 * 60 * 1000;

describe("CodesService.redeemCode (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CodesService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CodesService] }));
    service = moduleRef.get(CodesService);
  });

  beforeEach(() => resetDatabase(prisma));

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  const subscriptionCode = (planId: string, code = "PERF-TEST-0001") =>
    prisma.invitationCode.create({
      data: { code, type: "subscription", planId, durationDays: 30 },
    });

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

  /** The user's balance and the sum of the user's successful top-up rows. */
  const balanceAndLedger = async (userId: string) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ledger = await prisma.transaction.aggregate({
      where: { userId, type: "topup", status: "success" },
      _sum: { amount: true },
    });
    return { balance: user.balance.toNumber(), ledgerSum: ledger._sum.amount?.toNumber() ?? 0 };
  };

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
      expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(1);
    }
  });

  it("RX-147: refuses a user's second redemption of a code with uses left and changes nothing", async () => {
    const user = await createUser(prisma);
    const code = await topupCode(3);
    await service.redeemCode(user.id, code.code);

    await expect(service.redeemCode(user.id, code.code)).rejects.toBeInstanceOf(ConflictException);

    expect(await balanceAndLedger(user.id)).toEqual({ balance: 25, ledgerSum: 25 });
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 1,
    });
  });

  it("RX-147: refuses a second user on a single-use code with the maximum-redemptions 400", async () => {
    const [userA, userB] = [await createUser(prisma), await createUser(prisma)];
    const code = await topupCode(1);
    await service.redeemCode(userA.id, code.code);

    const redeemB = service.redeemCode(userB.id, code.code);

    await expect(redeemB).rejects.toBeInstanceOf(BadRequestException);
    await expect(redeemB).rejects.toThrow("maximum number of redemptions");
    expect(await balanceAndLedger(userB.id)).toEqual({ balance: 0, ledgerSum: 0 });
  });

  it("RX-147: keeps a fresh user's balance equal to the sum of the user's ledger rows after each redemption", async () => {
    const user = await createUser(prisma);
    const first = await topupCode(5, "PERF-TOPUP-0001");
    const second = await topupCode(5, "PERF-TOPUP-0002");

    await service.redeemCode(user.id, first.code);
    expect(await balanceAndLedger(user.id)).toEqual({ balance: 25, ledgerSum: 25 });
    await service.redeemCode(user.id, second.code);
    expect(await balanceAndLedger(user.id)).toEqual({ balance: 50, ledgerSum: 50 });
  });

  it("RX-147: grants a two-use code to exactly two of three users redeeming at the same moment", async () => {
    const users = [await createUser(prisma), await createUser(prisma), await createUser(prisma)];
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
    expect(await prisma.transaction.count()).toBe(2);
    const balances = await Promise.all(users.map((u) => balanceAndLedger(u.id)));
    expect(balances.map((b) => b.balance).sort()).toEqual([0, 25, 25]);
    balances.forEach((b) => expect(b.balance).toBe(b.ledgerSum));
  });

  it("RX-147: grants once when the same user redeems one code twice at the same moment (201 and 409, never 500)", async () => {
    const user = await createUser(prisma);
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
    expect(await prisma.transaction.count({ where: { userId: user.id } })).toBe(1);
    expect(await balanceAndLedger(user.id)).toEqual({ balance: 25, ledgerSum: 25 });
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 1,
    });
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

  it("refuses a second redemption by the same user and grants nothing more", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma);
    const code = await subscriptionCode(plan.id);
    await prisma.invitationCode.update({ where: { id: code.id }, data: { maxRedemptions: 5 } });
    await service.redeemCode(user.id, code.code);

    await expect(service.redeemCode(user.id, code.code)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.codeRedemption.count()).toBe(1);
  });

  it("rolls back every earlier step of a redemption when a later step fails", async () => {
    const user = await createUser(prisma);
    const plan = await createPlan(prisma, { slug: "pro" });
    const code = await prisma.invitationCode.create({
      data: { code: "PERF-BOTH-0001", type: "both", creditAmount: 25, planId: plan.id, durationDays: 30 },
    });
    jest
      .spyOn(moduleRef.get(CodeRedemptionRepository), "createRedemption")
      .mockRejectedValueOnce(new Error("the redemption row cannot be written"));

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toThrow("the redemption row cannot be written");
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { transactions: true, subscription: true, codeRedemptions: true },
    });
    expect(after.balance.toNumber()).toBe(0);
    expect(after.transactions).toEqual([]);
    expect(after.subscription).toBeNull();
    expect(after.codeRedemptions).toEqual([]);
    expect(await prisma.invitationCode.findUniqueOrThrow({ where: { id: code.id } })).toMatchObject({
      timesRedeemed: 0,
    });
  });

  it("leaves an existing subscription as it was when a later step of the redemption fails", async () => {
    const user = await createUser(prisma);
    const basic = await createPlan(prisma, { slug: "basic" });
    const pro = await createPlan(prisma, { slug: "pro" });
    const before = await createSubscription(prisma, { userId: user.id, planId: basic.id, status: "active", messagesUsed: 7 });
    const code = await subscriptionCode(pro.id);
    jest
      .spyOn(moduleRef.get(CodeRedemptionRepository), "createRedemption")
      .mockRejectedValueOnce(new Error("the redemption row cannot be written"));

    const redeem = service.redeemCode(user.id, code.code);

    await expect(redeem).rejects.toThrow("the redemption row cannot be written");
    const after = await prisma.userSubscription.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after).toMatchObject({
      planId: basic.id,
      messagesUsed: 7,
      currentPeriodEnd: before.currentPeriodEnd,
    });
  });
});
