import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `portal_sessions` (the chat portal's anonymous sessions). Every method takes the transaction
 * as its last argument: optional, and required on the free-request count (`incrementFreeRequestCount`), which
 * counts only together with the daily counters of the same reservation.
 */
@Injectable()
export class PortalSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The session with this token, if there is one. */
  findSessionByToken(sessionToken: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).portalSession.findUnique({
      where: { sessionToken },
    });
  }

  /** Sets this session's request count to 0 and its last reset to now; returns the row. */
  resetRequestCount(sessionToken: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).portalSession.update({
      where: { sessionToken },
      data: { requestCount: 0, lastResetAt: new Date() },
    });
  }

  /** The number of sessions from this hashed IP created at or after `since`. */
  countSessionsCreatedSince(
    ipAddress: string,
    since: Date,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).portalSession.count({
      where: {
        ipAddress,
        createdAt: {
          gte: since,
        },
      },
    });
  }

  /** Creates the session with this token and hashed IP (or none), reset now. */
  createSession(
    sessionToken: string,
    ipAddress: string | null,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).portalSession.create({
      data: {
        sessionToken,
        ipAddress,
        lastResetAt: new Date(),
      },
    });
  }

  /**
   * Counts one free request on this session unless it already has `limit` (one conditional UPDATE, so two
   * requests at the same time cannot both pass the limit). True when counted. Only inside a transaction.
   */
  async incrementFreeRequestCount(
    sessionToken: string,
    limit: number,
    tx: DbTransaction,
  ): Promise<boolean> {
    const session = await tx.$queryRaw<unknown[]>`
          UPDATE "portal_sessions"
          SET "requestCount" = "requestCount" + 1, "lastRequestAt" = now()
          WHERE "sessionToken" = ${sessionToken}
            AND "requestCount" < ${limit}
          RETURNING "requestCount"`;
    return session.length > 0;
  }

  /** Links the session with this token to this user, creating the session if there is none. */
  linkSessionToUser(sessionToken: string, userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).portalSession.upsert({
      where: { sessionToken },
      update: { userId },
      create: {
        sessionToken,
        userId,
        lastResetAt: new Date(),
      },
    });
  }

  /** Sets the request count to 0 and the last reset to now on every session last reset before `before`. */
  resetRequestCountsResetBefore(before: Date, tx?: DbTransaction) {
    return (tx ?? this.prisma).portalSession.updateMany({
      where: {
        lastResetAt: { lt: before },
      },
      data: { requestCount: 0, lastResetAt: new Date() },
    });
  }

  /** Deletes the sessions whose last request was before `before`. */
  deleteSessionsLastRequestedBefore(before: Date, tx?: DbTransaction) {
    return (tx ?? this.prisma).portalSession.deleteMany({
      where: {
        lastRequestAt: { lt: before },
      },
    });
  }
}
