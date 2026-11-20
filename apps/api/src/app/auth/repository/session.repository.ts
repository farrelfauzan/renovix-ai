import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** RNX-78: the queries on Better Auth's `sessions` table. Every method takes the transaction as its last argument, optional. */
@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This user's sessions that have not expired by `now`, most recently active first: never the token or the IP address. */
  findActiveSessions(userId: string, now: Date, tx?: DbTransaction) {
    return (tx ?? this.prisma).session.findMany({
      where: { userId, expiresAt: { gt: now } },
      select: { id: true, userAgent: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
  }
}
