import { Injectable } from "@nestjs/common";
import type { PaymentOrderChange, Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `payment_order_changes` (RNX-35): the audit of every order status change and flag. Only ever inserted. */
@Injectable()
export class PaymentOrderChangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts one change, in the transaction of the change it records. */
  create(data: Prisma.PaymentOrderChangeUncheckedCreateInput, tx: DbTransaction): Promise<PaymentOrderChange> {
    return tx.paymentOrderChange.create({ data });
  }

  /** The order's changes, oldest first. */
  findByOrder(orderId: string): Promise<PaymentOrderChange[]> {
    return this.prisma.paymentOrderChange.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  }
}
