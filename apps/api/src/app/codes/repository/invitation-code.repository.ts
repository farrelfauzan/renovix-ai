import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `invitation_codes`. Every method takes the transaction as its last argument: optional on
 * reads and admin writes, required on the write of a redemption (`claimRedemption`).
 */
@Injectable()
export class InvitationCodeRepository {
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
}
