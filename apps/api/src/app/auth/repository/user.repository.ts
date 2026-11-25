import { Injectable } from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { AdminUserListQuery } from "../types/admin-user-list-query";
import type { AdminUserListRow } from "../types/admin-user-list-row";
import type { ProfileStepData } from "../types/profile-step-data";

/** The queries on `users`. Every method takes the transaction as its last argument, optional. */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This user's profile fields; Prisma's not-found error (P2025) when there is no such user, as before RX-138. */
  findProfileOrThrow(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        name: true,
        firstName: true,
        lastName: true,
        avatar: true,
        phone: true,
        company: true,
        jobTitle: true,
        timezone: true,
        locale: true,
        country: true,
        signupGoal: true,
        role: true,
        defaultModelTier: true,
        profileCompletedAt: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** RNX-33: writes this user's answers to the profile step (the session user's own row only). */
  saveProfileStep(userId: string, data: ProfileStepData, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.update({ where: { id: userId }, data, select: { id: true } });
  }

  /** RNX-33: sets this user's profile completion time when it is not set yet; a later save keeps the first one. */
  markProfileCompleted(userId: string, completedAt: Date, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.updateMany({
      where: { id: userId, profileCompletedAt: null },
      data: { profileCompletedAt: completedAt },
    });
  }

  /** RNX-33: this user's saved timezone (the default of a reminder created without one), if there is such a user. */
  findTimezone(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUnique({ where: { id: userId }, select: { timezone: true } });
  }

  /** RNX-335: this user's saved language (an agent run's reply language), if there is such a user. */
  findLocale(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUnique({ where: { id: userId }, select: { locale: true } });
  }

  /** Updates this user's profile fields (PATCH /auth/me); the caller reads the profile again to answer. */
  updateProfile(userId: string, data: Prisma.UserUpdateInput, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.update({ where: { id: userId }, data, select: { id: true } });
  }

  /** RNX-334: this user's avatar column: an external https URL, an uploaded photo's storage key, or null. */
  findAvatarOrThrow(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUniqueOrThrow({ where: { id: userId }, select: { avatar: true } });
  }

  /** RNX-334: sets this user's avatar column (the session user's own row only); null removes it. */
  setAvatar(userId: string, avatar: string | null, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.update({ where: { id: userId }, data: { avatar }, select: { id: true } });
  }

  /** The id and email of each of these users that exists (RNX-228: the users of a usage report, emails masked there). */
  findEmails(userIds: readonly string[], tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, email: true } });
  }

  /** The id and email of this user, if there is one (the chat portal's signed-in user). */
  findPortalUser(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
  }

  /** The id and email of the user with this email, if there is one (the dev account seed, RNX-355). */
  findByEmail(email: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUnique({ where: { email }, select: { id: true, email: true } });
  }

  /**
   * RNX-357: one window of the back-office user list, deleted users left out, newest sign-in first (never signed in
   * last, then by id). One statement: the user's package (the snapshot the entitlement reports: highest display order,
   * then newest) and paid wallet are joined, and the status label is derived here, so every filter runs in the
   * database. The credits figure is the paid wallet's available credits (balance - held, 0 without a paid wallet), the
   * figure chat shows (RNX-358). "locked": no paid wallet, or its available credits at or below 0, as chat's lock.
   */
  findAdminListRows(query: AdminUserListQuery, tx?: DbTransaction): Promise<AdminUserListRow[]> {
    const userConditions = [
      Prisma.sql`u."status" <> 'deleted'`,
      query.email === undefined ? undefined : Prisma.sql`u."email" = ${query.email}`,
      query.id === undefined ? undefined : Prisma.sql`u."id" = ${query.id}`,
    ].filter((condition): condition is Prisma.Sql => condition !== undefined);
    const rowConditions = [
      query.packageId === undefined ? undefined : Prisma.sql`listed."packageId" = ${query.packageId}`,
      query.status === undefined ? undefined : Prisma.sql`listed."status" = ${query.status}`,
    ].filter((condition): condition is Prisma.Sql => condition !== undefined);
    return (tx ?? this.prisma).$queryRaw<AdminUserListRow[]>`
      SELECT listed.* FROM (
        SELECT u."id", u."name", u."last_login_at" AS "lastLoginAt",
          pkg."id" AS "packageId", pkg."name" AS "packageName", COALESCE(ca."balance" - ca."held", 0) AS "creditsAvailable",
          CASE WHEN u."status" = 'suspended' THEN 'suspended'
            WHEN ca."id" IS NULL OR ca."balance" - ca."held" <= 0 THEN 'locked'
            ELSE 'active' END AS "status"
        FROM "users" u
        LEFT JOIN "credit_accounts" ca ON ca."user_id" = u."id" AND ca."wallet" = 'paid'
        LEFT JOIN LATERAL (
          SELECT p."id", p."name" FROM "purchase_snapshots" ps
          JOIN "package_versions" pv ON pv."id" = ps."package_version_id"
          JOIN "packages" p ON p."id" = pv."package_id"
          WHERE ps."buyer_user_id" = u."id" AND ps."package_version_id" IS NOT NULL
          ORDER BY p."display_order" DESC, ps."created_at" DESC, ps."id" ASC
          LIMIT 1
        ) pkg ON TRUE
        WHERE ${Prisma.join(userConditions, " AND ")}
      ) listed
      WHERE ${rowConditions.length ? Prisma.join(rowConditions, " AND ") : Prisma.sql`TRUE`}
      ORDER BY listed."lastLoginAt" DESC NULLS LAST, listed."id" ASC
      LIMIT ${query.limit} OFFSET ${query.offset}`;
  }

  /**
   * RNX-357: the back-office detail fields of this user that the list row does not hold, unless the user is deleted:
   * phone, timezone, language, joined date and sign-in methods (the providers of its accounts, nothing else of them).
   */
  findAdminProfile(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findFirst({
      where: { id: userId, status: { not: "deleted" } },
      select: { phone: true, timezone: true, locale: true, createdAt: true, accounts: { select: { providerId: true } } },
    });
  }

  /** RNX-357: one personal field of this user (only that column is read), unless the user is deleted. */
  findPiiField(userId: string, field: "email" | "phone" | "name", tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findFirst({
      where: { id: userId, status: { not: "deleted" } },
      select: { email: field === "email", phone: field === "phone", name: field === "name" },
    });
  }
}
