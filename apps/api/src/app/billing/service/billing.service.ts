import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";
import { CreditLedgerService } from "./credit-ledger.service";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly creditLedger: CreditLedgerService,
  ) {}

  /**
   * Atomically reserve credits for a request. Returns the reserved amount.
   * Uses an atomic UPDATE with balance check to prevent race conditions.
   */
  async reserveCredits(
    userId: string,
    estimatedCost: Decimal,
  ): Promise<Decimal> {
    // Atomic: UPDATE balance = balance - cost WHERE balance >= cost
    const result = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "users" SET balance = balance - ${estimatedCost} WHERE id = ${userId} AND balance >= ${estimatedCost}`,
    );

    if (result === 0) {
      throw new BadRequestException("Insufficient balance");
    }

    // Log the reservation transaction
    await this.prisma.transaction.create({
      data: {
        userId,
        amount: estimatedCost.negated(),
        type: "deduction",
        status: "pending",
        reference: null,
      },
    });

    return estimatedCost;
  }

  /**
   * Adjust the balance after getting actual cost.
   * Refunds the difference between estimated and actual cost.
   */
  async adjustBalance(
    userId: string,
    estimatedCost: Decimal,
    actualCost: Decimal,
  ): Promise<void> {
    const refund = estimatedCost.sub(actualCost);

    await this.prisma.$transaction(async (tx) => {
      if (refund.gt(0)) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE "users" SET balance = balance + ${refund} WHERE id = ${userId}`,
        );
      } else if (refund.lt(0)) {
        // Actual cost exceeded estimate — deduct more
        const additional = refund.abs();
        await tx.$executeRaw(
          Prisma.sql`UPDATE "users" SET balance = balance - ${additional} WHERE id = ${userId}`,
        );
      }

      // Update the pending transaction to success with actual cost
      await tx.transaction.create({
        data: {
          userId,
          amount: actualCost.negated(),
          type: "deduction",
          status: "success",
        },
      });
    });
  }

  /**
   * Full refund on provider failure.
   */
  async refundReservation(
    userId: string,
    reservedAmount: Decimal,
  ): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "users" SET balance = balance + ${reservedAmount} WHERE id = ${userId}`,
    );

    await this.prisma.transaction.create({
      data: {
        userId,
        amount: reservedAmount,
        type: "refund",
        status: "success",
      },
    });

    this.logger.log(`Refunded ${reservedAmount} to user ${userId}`);
  }

  /**
   * Add balance (for top-ups): one `top_up` ledger entry on the user's paid wallet (RX-22, docs/credits.md section
   * 2.1), with the payment's reference; the same reference again writes nothing (I8). A zero amount writes no entry
   * (D186: grants are > 0). User.balance and the Transaction table are no longer written (D190).
   */
  async addBalance(
    userId: string,
    amount: Decimal,
    reference: string,
  ): Promise<void> {
    if (amount.isZero()) return;
    await this.creditLedger.appendEntry({
      owner: { userId },
      wallet: "paid",
      type: "top_up",
      amount,
      memberUserId: userId,
      reference,
      idempotencyKey: `top_up:${reference}`,
    });
  }

  /**
   * Get user balance.
   */
  async getBalance(userId: string): Promise<Decimal> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true },
    });
    return user.balance;
  }
}
