import { Injectable } from "@nestjs/common";
import type { PaymentUnmatchedPayment, Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";
import type { RefundMark } from "../types/refund-mark";
import type { TimeRange } from "../types/time-range";

/** The queries on `payment_unmatched_payments` (RNX-35): payments the provider reported that grant nothing. */
@Injectable()
export class PaymentUnmatchedPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Records the payment unless its (provider, reference) is recorded already: a repeated webhook adds nothing. */
  async createIfAbsent(data: Prisma.PaymentUnmatchedPaymentCreateManyInput, tx?: DbTransaction): Promise<void> {
    await (tx ?? this.prisma).paymentUnmatchedPayment.createMany({ data: [data], skipDuplicates: true });
  }

  /** The unmatched payment with this id, if any. */
  findById(id: string, tx?: DbTransaction): Promise<PaymentUnmatchedPayment | null> {
    return (tx ?? this.prisma).paymentUnmatchedPayment.findUnique({ where: { id } });
  }

  /** Marks an open unmatched payment refunded; false when it was not open. */
  async markRefunded(id: string, mark: RefundMark, tx: DbTransaction): Promise<boolean> {
    const { count } = await tx.paymentUnmatchedPayment.updateMany({
      where: { id, status: "open" },
      data: { status: "refunded", refundedAt: mark.at, refundedBy: mark.adminId, refundNote: mark.note },
    });
    return count === 1;
  }

  /** The unmatched payments recorded in `range`, oldest first. */
  findCreatedIn(range: TimeRange): Promise<PaymentUnmatchedPayment[]> {
    return this.prisma.paymentUnmatchedPayment.findMany({ where: { createdAt: { gte: range.start, lt: range.end } }, orderBy: { createdAt: "asc" } });
  }
}
