import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `code_redemptions`. Every method takes the transaction as its last argument: optional on
 * reads, required on the write of a redemption (`createRedemption`).
 */
@Injectable()
export class CodeRedemptionRepository {
  constructor(private readonly prisma: PrismaService) {}

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
