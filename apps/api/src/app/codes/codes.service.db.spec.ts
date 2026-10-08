import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { CodesService } from "./codes.service";
import { PrismaService } from "../prisma/prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createPlan, createSubscription, createUser } from "../../../test/factories";

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

  afterAll(() => moduleRef?.close());

  const subscriptionCode = (planId: string, code = "PERF-TEST-0001") =>
    prisma.invitationCode.create({
      data: { code, type: "subscription", planId, durationDays: 30 },
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
});
