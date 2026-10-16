import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries of the codes module: invitation codes, their redemptions, and the rows a redemption
 * writes (balance, top-up transaction, subscription). Every method takes the transaction as its last
 * argument: optional on reads and admin writes, required on the writes of a redemption.
 */
@Injectable()
export class CodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The invitation code with this code text, with its plan. */
  findCodeWithPlan(code: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).invitationCode.findUnique({
      where: { code },
      include: { plan: true },
    });
  }

  /** The invitation code with this id. */
  findCodeById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).invitationCode.findUnique({
      where: { id },
    });
  }

  /** One page of invitation codes, newest first, each with its plan and its number of redemptions. */
  listCodes(skip: number, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).invitationCode.findMany({
      include: {
        plan: { select: { slug: true, name: true } },
        _count: { select: { redemptions: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
  }

  /** The number of invitation codes. */
  countCodes(tx?: DbTransaction) {
    return (tx ?? this.prisma).invitationCode.count();
  }

  /** Creates an invitation code and returns it with its plan. */
  createCode(
    data: Prisma.InvitationCodeUncheckedCreateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).invitationCode.create({
      data,
      include: { plan: true },
    });
  }

  /** Updates the invitation code with this id. */
  updateCode(
    id: string,
    data: Prisma.InvitationCodeUncheckedUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).invitationCode.update({
      where: { id },
      data,
    });
  }

  /** The subscription plan with this id. */
  findPlanById(planId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).subscriptionPlan.findUnique({
      where: { id: planId },
    });
  }

  /** This user's redemption of this code, if there is one. */
  findRedemption(codeId: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).codeRedemption.findUnique({
      where: { codeId_userId: { codeId, userId } },
    });
  }

  /** This user's redemptions, newest first, each with the code text and type. */
  findRedemptionsByUser(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).codeRedemption.findMany({
      where: { userId },
      include: {
        code: { select: { code: true, type: true } },
      },
      orderBy: { redeemedAt: "desc" },
    });
  }

  /** This user's subscription, if there is one. */
  findSubscriptionByUserId(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userSubscription.findUnique({
      where: { userId },
    });
  }

  /** Adds `amount` to this user's balance. Only inside a transaction. */
  incrementUserBalance(
    userId: string,
    amount: Prisma.Decimal,
    tx: DbTransaction,
  ) {
    return tx.user.update({
      where: { id: userId },
      data: {
        balance: { increment: amount },
      },
    });
  }

  /** Writes the successful top-up row of this user for `amount`. Only inside a transaction. */
  createTopupTransaction(
    userId: string,
    amount: Prisma.Decimal,
    reference: string,
    tx: DbTransaction,
  ) {
    return tx.transaction.create({
      data: {
        userId,
        amount,
        type: "topup",
        status: "success",
        reference,
      },
    });
  }

  /** Creates this user's subscription. Only inside a transaction. */
  createSubscription(
    userId: string,
    data: Omit<Prisma.UserSubscriptionUncheckedCreateInput, "userId">,
    tx: DbTransaction,
  ) {
    return tx.userSubscription.create({
      data: { userId, ...data },
    });
  }

  /** Updates this user's subscription. Only inside a transaction. */
  updateSubscription(
    userId: string,
    data: Prisma.UserSubscriptionUncheckedUpdateInput,
    tx: DbTransaction,
  ) {
    return tx.userSubscription.update({
      where: { userId },
      data,
    });
  }

  /**
   * Counts one more redemption on this code if it has one left, and says whether it did. The row lock
   * this takes makes concurrent redemptions of the same code wait for each other. Only inside a transaction.
   */
  async claimRedemption(codeId: string, tx: DbTransaction): Promise<boolean> {
    const { count } = await tx.invitationCode.updateMany({
      where: {
        id: codeId,
        timesRedeemed: { lt: tx.invitationCode.fields.maxRedemptions },
      },
      data: { timesRedeemed: { increment: 1 } },
    });
    return count === 1;
  }

  /** Writes the row that says this user redeemed this code, with what it granted. Only inside a transaction. */
  createRedemption(
    codeId: string,
    userId: string,
    granted: Pick<
      Prisma.CodeRedemptionUncheckedCreateInput,
      "creditsGranted" | "planGranted" | "daysGranted"
    >,
    tx: DbTransaction,
  ) {
    return tx.codeRedemption.create({
      data: { codeId, userId, ...granted },
    });
  }
}
