import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estimate token count from messages using char count / 4 approximation.
   */
  estimateTokens(messages: { content: string }[]): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4);
  }

  /**
   * Estimate cost based on estimated input tokens, model pricing, and credit multiplier.
   */
  estimateCost(
    estimatedTokens: number,
    inputPrice: number,
    creditMultiplier: number,
  ): Decimal {
    return new Decimal(estimatedTokens)
      .mul(new Decimal(inputPrice))
      .mul(new Decimal(creditMultiplier));
  }

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
   * Calculate actual cost from provider usage response, including credit multiplier.
   */
  calculateActualCost(
    inputTokens: number,
    outputTokens: number,
    inputPrice: number,
    outputPrice: number,
    creditMultiplier: number,
  ): Decimal {
    const inputCost = new Decimal(inputTokens).mul(new Decimal(inputPrice));
    const outputCost = new Decimal(outputTokens).mul(new Decimal(outputPrice));
    return inputCost.add(outputCost).mul(new Decimal(creditMultiplier));
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
   * Add balance (for top-ups).
   */
  async addBalance(
    userId: string,
    amount: Decimal,
    reference?: string,
  ): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "users" SET balance = balance + ${amount} WHERE id = ${userId}`,
    );

    await this.prisma.transaction.create({
      data: {
        userId,
        amount,
        type: "topup",
        status: "success",
        reference: reference ?? null,
      },
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
