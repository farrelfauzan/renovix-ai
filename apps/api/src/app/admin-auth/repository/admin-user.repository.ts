import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `admin_users` (RX-94). Every method takes the transaction as its last argument. */
@Injectable()
export class AdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The admin with this (lowercased) email. */
  findByEmail(email: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminUser.findUnique({ where: { email } });
  }

  /** The admin with this id. */
  findById(adminId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).adminUser.findUnique({ where: { id: adminId } });
  }

  /** Counts one more failed attempt and returns the row as it is now. Only inside a transaction (row lock until commit). */
  incrementFailedAttempts(adminId: string, tx: DbTransaction) {
    return tx.adminUser.update({
      where: { id: adminId },
      data: { failedAttempts: { increment: 1 } },
    });
  }

  /** Locks the admin until `until` and resets the count, if the count reached `maxAttempts`. Returns the number of rows changed (0 or 1). */
  async lockIfOverLimit(adminId: string, maxAttempts: number, until: Date, tx: DbTransaction): Promise<number> {
    const { count } = await tx.adminUser.updateMany({
      where: { id: adminId, failedAttempts: { gte: maxAttempts } },
      data: { failedAttempts: 0, lockedUntil: until },
    });
    return count;
  }

  /**
   * The last step of a successful sign-in or re-authentication: clears the failed attempts and an expired
   * lock, only if the admin is not locked at `now` (one conditional UPDATE, so a lock set by a parallel
   * failure during the password check wins). Returns 1 when not locked, else 0.
   */
  async clearFailuresIfUnlocked(adminId: string, now: Date, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).adminUser.updateMany({
      where: { id: adminId, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    return count;
  }

  /**
   * Records `step` as the last accepted TOTP step, only if it is later than the stored one: one
   * conditional UPDATE, so two requests with the same code cannot both pass. Returns 1 when accepted, else 0.
   */
  async acceptTimeStep(adminId: string, step: number, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).adminUser.updateMany({
      where: {
        id: adminId,
        OR: [{ lastAcceptedTimeStep: null }, { lastAcceptedTimeStep: { lt: step } }],
      },
      data: { lastAcceptedTimeStep: step },
    });
    return count;
  }

  /** Stores a new, not yet active, encrypted TOTP secret on an admin who has not enrolled. Returns 0 or 1. */
  async setPendingTotpSecret(adminId: string, encrypted: string, tx?: DbTransaction): Promise<number> {
    const { count } = await (tx ?? this.prisma).adminUser.updateMany({
      where: { id: adminId, totpEnrolledAt: null },
      data: { totpSecretEncrypted: encrypted },
    });
    return count;
  }

  /**
   * The ids of the admins holding `role`, locking their rows until the transaction ends (RX-96: a parallel
   * role change waits, then sees the committed roles). Raw SQL: Prisma has no SELECT ... FOR UPDATE.
   */
  async lockIdsWithRole(role: string, tx: DbTransaction): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "admin_users" WHERE "role" = ${role}::text ORDER BY "id" FOR UPDATE`;
    return rows.map((row) => row.id);
  }

  /** Gives the admin the role with this name. Returns 0 (no such admin) or 1; 400 when no role has that name. */
  async updateRole(adminId: string, role: string, tx: DbTransaction): Promise<number> {
    try {
      const { count } = await tx.adminUser.updateMany({ where: { id: adminId }, data: { role } });
      return count;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new BadRequestException("Unknown role");
      }
      throw err;
    }
  }

  /** Activates the stored TOTP secret, if the admin has not enrolled yet. Returns 0 or 1. */
  async markTotpEnrolled(adminId: string, at: Date, tx: DbTransaction): Promise<number> {
    const { count } = await tx.adminUser.updateMany({
      where: { id: adminId, totpEnrolledAt: null, totpSecretEncrypted: { not: null } },
      data: { totpEnrolledAt: at },
    });
    return count;
  }
}
