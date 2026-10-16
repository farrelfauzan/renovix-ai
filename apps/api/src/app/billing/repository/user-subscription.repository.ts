import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `user_subscriptions`. Every method takes the transaction as its last argument: optional on
 * reads, required on the writes (`createSubscription`, `updateSubscription`).
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
}
