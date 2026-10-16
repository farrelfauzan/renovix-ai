import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `user_subscriptions`. Every method takes the transaction as its last argument: optional on
 * reads and on the writes of the agent module (RX-133: `createSubscriptionWithPlan`, `updateSubscriptionWithPlan`),
 * required on the writes of a redemption (`createSubscription`, `updateSubscription`).
 */
@Injectable()
export class UserSubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** This user's subscription, if there is one. */
  findSubscriptionByUserId(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userSubscription.findUnique({
      where: { userId },
    });
  }

  /** This user's subscription with its plan, if there is one (RX-133). */
  findSubscriptionWithPlan(userId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).userSubscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
  }

  /** Creates this user's subscription. Only inside a transaction. */
  createSubscription(
    userId: string,
    data: Omit<Prisma.UserSubscriptionUncheckedCreateInput, "userId">,
    tx: DbTransaction,
  ) {
    return tx.userSubscription.create({
      data: { userId, ...data },
    });
  }

  /** Updates this user's subscription. Only inside a transaction. */
  updateSubscription(
    userId: string,
    data: Prisma.UserSubscriptionUncheckedUpdateInput,
    tx: DbTransaction,
  ) {
    return tx.userSubscription.update({
      where: { userId },
      data,
    });
  }

  /** Creates this user's subscription and returns it with its plan (RX-133). */
  createSubscriptionWithPlan(
    userId: string,
    data: Omit<Prisma.UserSubscriptionUncheckedCreateInput, "userId">,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).userSubscription.create({
      data: { userId, ...data },
      include: { plan: true },
    });
  }

  /** Updates this user's subscription and returns it with its plan (RX-133). */
  updateSubscriptionWithPlan(
    userId: string,
    data: Prisma.UserSubscriptionUncheckedUpdateInput,
    tx?: DbTransaction,
  ) {
    return (tx ?? this.prisma).userSubscription.update({
      where: { userId },
      data,
      include: { plan: true },
    });
  }
}
