import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

const SUBSCRIPTION_CHANGED =
  "Your subscription was changed by another redemption at the same time; please try again";

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

  /**
   * Creates this user's subscription. A 409 when the user has one already (the unique `user_id`): another
   * redemption created it after this caller read none (RX-181). Only inside a transaction.
   */
  async createSubscription(
    userId: string,
    data: Omit<Prisma.UserSubscriptionUncheckedCreateInput, "userId">,
    tx: DbTransaction,
  ) {
    try {
      return await tx.userSubscription.create({
        data: { userId, ...data },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(SUBSCRIPTION_CHANGED);
      }
      throw err;
    }
  }

  /**
   * Updates this user's subscription if its `currentPeriodEnd` is still `readPeriodEnd`, the end the caller read.
   * A 409 when it is not: another redemption changed it after this caller read it (RX-181). The match is to the
   * millisecond read, not exact: a stored end with microseconds (a row this API did not write) reads truncated.
   * Only inside a transaction.
   */
  async updateSubscription(
    userId: string,
    readPeriodEnd: Date,
    data: Prisma.UserSubscriptionUncheckedUpdateInput,
    tx: DbTransaction,
  ): Promise<void> {
    const { count } = await tx.userSubscription.updateMany({
      where: {
        userId,
        currentPeriodEnd: { gte: readPeriodEnd, lt: new Date(readPeriodEnd.getTime() + 1) },
      },
      data,
    });
    if (count === 0) {
      throw new ConflictException(SUBSCRIPTION_CHANGED);
    }
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
