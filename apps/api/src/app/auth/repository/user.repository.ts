import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `users`. Every method takes the transaction as its last argument: optional, and required on
 * a balance change (`incrementUserBalance`).
 */
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The user with this email, if there is one (the whole row, password hash included). */
  findUserByEmail(email: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUnique({
      where: { email },
    });
  }

  /** Creates an email and password user; returns the fields the sign-up answers with. */
  createUser(
    data: Pick<Prisma.UserCreateInput, "email" | "password" | "apiKey" | "name">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).user.create({
      data,
      select: {
        id: true,
        email: true,
        name: true,
        apiKey: true,
        balance: true,
        createdAt: true,
      },
    });
  }

  /** Sets this user's last sign-in time to now. */
  updateLastLogin(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

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
        balance: true,
        apiKey: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** Replaces this user's API key. */
  updateApiKey(userId: string, apiKey: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.update({
      where: { id: userId },
      data: { apiKey },
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

  /** The id, email and balance of this user, if there is one (the chat portal's signed-in user). */
  findPortalUser(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, balance: true },
    });
  }

  /** Adds `amount` to this user's balance. Only inside a transaction. */
  incrementUserBalance(
    userId: string,
    amount: Prisma.Decimal,
    tx: DbTransaction,
  ) {
    return tx.user.update({
      where: { id: userId },
      data: {
        balance: { increment: amount },
      },
    });
  }

  /** The id and balance of this user with their first successful top-up transaction, if there is one. */
  findUserWithFirstTopup(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        balance: true,
        transactions: {
          take: 1,
          where: { type: "topup", status: "success" },
        },
      },
    });
  }
}
