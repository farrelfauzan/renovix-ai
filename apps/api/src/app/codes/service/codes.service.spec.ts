import { NotFoundException } from "@nestjs/common";
import { CodesService } from "./codes.service";
import { InvitationCodeRepository } from "../repository/invitation-code.repository";
import { CodeRedemptionRepository } from "../repository/code-redemption.repository";
import { SubscriptionPlanRepository } from "../../billing/repository/subscription-plan.repository";
import { UserSubscriptionRepository } from "../../billing/repository/user-subscription.repository";
import { TransactionRepository } from "../../billing/repository/transaction.repository";
import { UserRepository } from "../../auth/repository/user.repository";
import { TransactionService } from "../../prisma/transaction.service";

// PrismaService loads the generated client; a plain mock object is passed in instead.
jest.mock("../../prisma/prisma.service", () => ({ PrismaService: class {} }));

function setup(code: unknown) {
  const tx = {
    userSubscription: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
    invitationCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), fields: { maxRedemptions: {} } },
    codeRedemption: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    user: { update: jest.fn() },
    transaction: { create: jest.fn() },
  };
  const prisma = {
    invitationCode: { findUnique: jest.fn().mockResolvedValue(code) },
    codeRedemption: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const service = new CodesService(
    new InvitationCodeRepository(prisma as never),
    new CodeRedemptionRepository(prisma as never),
    new SubscriptionPlanRepository(prisma as never),
    new UserSubscriptionRepository(prisma as never),
    new TransactionRepository(),
    new UserRepository(),
    new TransactionService(prisma as never),
  );
  return { service, tx };
}

describe("RX-2: code redemption still grants a plan", () => {
  it("creates an active subscription for the code's plan", async () => {
    const { service, tx } = setup({
      id: "code-1",
      code: "PERF-AAAA-BBBB",
      type: "subscription",
      isActive: true,
      expiresAt: new Date(Date.now() + 86_400_000),
      timesRedeemed: 0,
      maxRedemptions: 1,
      planId: "plan-pro",
      durationDays: 30,
      creditAmount: null,
      plan: { slug: "pro" },
    });

    const res = await service.redeemCode("user-1", "PERF-AAAA-BBBB");

    expect(tx.userSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        planId: "plan-pro",
        status: "active",
      }),
    });
    expect(res).toMatchObject({ success: true, planGranted: "pro", daysGranted: 30 });
  });

  it("rejects an unknown code and never touches userSubscription", async () => {
    const { service, tx } = setup(null);

    await expect(service.redeemCode("user-1", "PERF-NOPE-NOPE")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.userSubscription.findUnique).not.toHaveBeenCalled();
    expect(tx.userSubscription.create).not.toHaveBeenCalled();
    expect(tx.userSubscription.update).not.toHaveBeenCalled();
  });
});
