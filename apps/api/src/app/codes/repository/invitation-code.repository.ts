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

  /** The invitation code with this code text, with the package version it grants and that package's name (RNX-251). */
  findCodeWithPackage(code: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).invitationCode.findUnique({
      where: { code },
      include: { packageVersion: { include: { package: { select: { name: true } } } } },
    });
  }

  /** The invitation code with this id. */
  findCodeById(id: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).invitationCode.findUnique({
      where: { id },
    });
  }

  /** One page of invitation codes, newest first, each with its package version (RNX-251) and its number of redemptions. */
  listCodes(skip: number, take: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).invitationCode.findMany({
      include: {
        packageVersion: { select: { id: true, versionNumber: true, package: { select: { name: true } } } },
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

  /** Creates an invitation code and returns it. */
  createCode(
    data: Prisma.InvitationCodeUncheckedCreateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).invitationCode.create({ data });
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
   * Counts one more redemption on this code if, at `now`, it is active, not expired and has one left, and says
   * whether it did. The three conditions are checked in this one conditional update, under the row lock it takes,
   * so a code deactivated or expired after the service's pre-checks is refused (RX-181), and concurrent redemptions
   * of the same code wait for each other. The service's re-check after this call (the user's redemption, a 409)
   * relies on READ COMMITTED, the default isolation level of `TransactionService.run`: the update re-reads the row
   * after a concurrent commit. Under a stricter isolation level the waiting redemption fails with a serialization
   * error instead of that 409. Only inside a transaction.
   */
  async claimRedemption(codeId: string, now: Date, tx: DbTransaction): Promise<boolean> {
    const { count } = await tx.invitationCode.updateMany({
      where: {
        id: codeId,
        isActive: true,
        expiresAt: { gte: now },
        timesRedeemed: { lt: tx.invitationCode.fields.maxRedemptions },
      },
      data: { timesRedeemed: { increment: 1 } },
    });
    return count === 1;
  }
}
