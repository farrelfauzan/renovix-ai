import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `payment_unmatched_payments` (RNX-35): payments the provider reported that grant nothing. */
@Injectable()
export class PaymentUnmatchedPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Records the payment unless its (provider, reference) is recorded already: a repeated webhook adds nothing. */
  async createIfAbsent(data: Prisma.PaymentUnmatchedPaymentCreateManyInput, tx?: DbTransaction): Promise<void> {
    await (tx ?? this.prisma).paymentUnmatchedPayment.createMany({ data: [data], skipDuplicates: true });
  }
}
