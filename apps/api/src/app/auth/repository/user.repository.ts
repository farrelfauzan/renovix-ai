import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

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
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
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
