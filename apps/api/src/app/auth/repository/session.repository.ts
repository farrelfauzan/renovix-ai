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

  /** RNX-100: this user's newest `limit` sessions, expired ones included: never the token or the IP address. */
  findLatestOfUser(userId: string, limit: number, tx?: DbTransaction) {
    return (tx ?? this.prisma).session.findMany({
      where: { userId },
      select: { id: true, createdAt: true, expiresAt: true, userAgent: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });
  }

  /** RNX-100: deletes this user's session with this id (another user's session is left alone); returns 0 or 1. */
  async deleteOfUser(userId: string, sessionId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).session.deleteMany({ where: { id: sessionId, userId } });
    return count;
  }

  /** RNX-100: deletes every session of this user; returns how many were deleted. */
  async deleteAllOfUser(userId: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).session.deleteMany({ where: { userId } });
    return count;
  }
}
