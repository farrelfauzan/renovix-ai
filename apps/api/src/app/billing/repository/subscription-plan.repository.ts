import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `subscription_plans`. Every method takes the transaction as its optional last argument. */
@Injectable()
export class SubscriptionPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The subscription plan with this id. */
  findPlanById(planId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).subscriptionPlan.findUnique({
      where: { id: planId },
    });
  }

  /** The subscription plan with this slug (RX-133). */
  findPlanBySlug(slug: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).subscriptionPlan.findUnique({
      where: { slug },
    });
  }
}
