import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** Used refresh token hashes kept per session (reuse detection for the latest 100 rotations). */
const MAX_USED_REFRESH_HASHES = 100;

/** The queries on `admin_sessions` (RX-94, D54). Every method takes the transaction as its last argument. */
@Injectable()
export class AdminSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a session. */
  create(data: Prisma.AdminSessionUncheckedCreateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminSession.create({ data });
  }

  /** The session with this id, with its admin's role. */
  findWithAdminRole(sessionId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminSession.findUnique({
      where: { id: sessionId },
      include: { admin: { select: { role: true } } },
    });
  }

  /**
   * Replaces the refresh token hash `currentHash` by `nextHash` and records the old one as used, keeping
   * only the latest MAX_USED_REFRESH_HASHES, only if the session is not revoked and still has `currentHash`.
   * One conditional UPDATE (raw SQL: Prisma's `push` cannot trim the array). Returns 0 or 1.
   */
  rotateRefreshToken(sessionId: string, currentHash: string, nextHash: string, now: Date, tx?: DbTransaction): Promise<number> {
    return (tx ?? this.prisma).$executeRaw`
      UPDATE "admin_sessions"
      SET "refresh_token_hash" = ${nextHash}::text,
          "used_refresh_token_hashes" = (array_append(COALESCE("used_refresh_token_hashes", '{}'::text[]), ${currentHash}::text))
            [GREATEST(cardinality(COALESCE("used_refresh_token_hashes", '{}'::text[])) + 2 - ${MAX_USED_REFRESH_HASHES}::int, 1):],
          "last_seen_at" = ${now}
      WHERE "id" = ${sessionId}::text AND "refresh_token_hash" = ${currentHash}::text AND "revoked_at" IS NULL`;
  }

  /** Records activity on a session that is not revoked. */
  async touch(sessionId: string, now: Date, tx?: DbTransaction): Promise<void> {
    await (tx ?? this.prisma).adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: now },
    });
  }

  /** Records a successful re-authentication on a session that is not revoked. */
  async markReauth(sessionId: string, now: Date, tx?: DbTransaction): Promise<void> {
    await (tx ?? this.prisma).adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastReauthAt: now },
    });
  }

  /** Revokes a session that is not revoked yet. Returns 0 or 1. */
  async revoke(sessionId: string, now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }

  /** Revokes this admin's session, if it is theirs and not revoked yet. Returns 0 or 1. */
  async revokeForAdmin(sessionId: string, adminId: string, now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).adminSession.updateMany({
      where: { id: sessionId, adminId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }

  /** This admin's sessions that are not revoked, seen after `seenAfter` and not past their absolute limit, newest first. No token hashes. */
  listActiveForAdmin(adminId: string, now: Date, seenAfter: Date, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminSession.findMany({
      where: { adminId, revokedAt: null, absoluteExpiresAt: { gt: now }, lastSeenAt: { gt: seenAfter } },
      select: {
        id: true,
        scope: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        absoluteExpiresAt: true,
        lastReauthAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
