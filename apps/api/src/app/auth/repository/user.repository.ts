import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
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

  /** Updates this user's profile fields; returns the fields the profile update answers with. */
  updateProfile(
    userId: string,
    data: Prisma.UserUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        phone: true,
        company: true,
        jobTitle: true,
        timezone: true,
        locale: true,
        updatedAt: true,
      },
    });
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
}
