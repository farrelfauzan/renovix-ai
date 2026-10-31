import { NotFoundException } from "@nestjs/common";
import { CodesService } from "./codes.service";
import { InvitationCodeRepository } from "../repository/invitation-code.repository";
import { CodeRedemptionRepository } from "../repository/code-redemption.repository";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../../billing/service/package-ownership.service";
import type { PackageRepository } from "../../offers/repository/package.repository";
import type { PurchaseSnapshotService } from "../../offers/service/purchase-snapshot.service";
import { TransactionService } from "../../prisma/transaction.service";

// PrismaService loads the generated client; a plain mock object is passed in instead.
jest.mock("../../prisma/prisma.service", () => ({ PrismaService: class {} }));

function setup(code: unknown) {
  // RNX-251: the transaction has no userSubscription delegate; a redemption that touched one would throw.
  const tx = {
    invitationCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), fields: { maxRedemptions: {} } },
    codeRedemption: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
  };
  const prisma = {
    invitationCode: { findUnique: jest.fn().mockResolvedValue(code) },
    codeRedemption: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const mockRecordCodeGrant = jest.fn().mockResolvedValue({});
  const service = new CodesService(
    new InvitationCodeRepository(prisma as never),
    new CodeRedemptionRepository(prisma as never),
    {} as unknown as PackageRepository,
    { recordCodeGrant: mockRecordCodeGrant } as unknown as PurchaseSnapshotService,
    { appendEntry: jest.fn() } as unknown as CreditLedgerService,
    new TransactionService(prisma as never),
    { hasPackage: jest.fn().mockResolvedValue(true) } as unknown as PackageOwnershipService,
  );
  return { service, tx, mockRecordCodeGrant };
}

describe("RNX-251: code redemption grants a package as a purchase snapshot", () => {
  it("records a code grant of the code's package version in the redemption transaction", async () => {
    const { service, tx, mockRecordCodeGrant } = setup({
      id: "code-1",
      code: "PERF-AAAA-BBBB",
      type: "subscription",
      isActive: true,
      expiresAt: new Date(Date.now() + 86_400_000),
      timesRedeemed: 0,
      maxRedemptions: 1,
      packageVersionId: "version-pro",
      creditAmount: null,
      packageVersion: { package: { name: "Pro" } },
    });

    const actualResponse = await service.redeemCode("user-1", "PERF-AAAA-BBBB");

    expect(mockRecordCodeGrant).toHaveBeenCalledWith({ buyerUserId: "user-1", packageVersionId: "version-pro" }, tx);
    expect(actualResponse).toEqual({ success: true, creditsGranted: null, planGranted: "Pro", daysGranted: null });
  });

  it("rejects an unknown code and records no package", async () => {
    const { service, mockRecordCodeGrant } = setup(null);

    await expect(service.redeemCode("user-1", "PERF-NOPE-NOPE")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockRecordCodeGrant).not.toHaveBeenCalled();
  });
});
