import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Decimal } from "@prisma/client/runtime/client";
import { TransactionService } from "../../prisma/transaction.service";
import { CreateCodeDto } from "../dto/redeem-code.dto";
import { CodesRepository } from "../repository/codes.repository";

@Injectable()
export class CodesService {
  constructor(
    private readonly codes: CodesRepository,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * Generate a unique invitation code in format PERF-XXXX-XXXX
   */
  private generateCode(): string {
    const segment = () => crypto.randomBytes(2).toString("hex").toUpperCase();
    return `PERF-${segment()}-${segment()}`;
  }

  /**
   * Redeem an invitation code for a user.
   * Grants credits and/or subscription plan based on the code type.
   */
  async redeemCode(userId: string, codeString: string) {
    const code = await this.codes.findCodeWithPlan(codeString);

    if (!code) {
      throw new NotFoundException("Invalid invitation code");
    }

    if (!code.isActive) {
      throw new BadRequestException("This code has been deactivated");
    }

    if (new Date() > code.expiresAt) {
      throw new BadRequestException("This code has expired");
    }

    if (code.timesRedeemed >= code.maxRedemptions) {
      throw new BadRequestException(
        "This code has reached its maximum number of redemptions",
      );
    }

    // Check if user already redeemed this code
    const existingRedemption = await this.codes.findRedemption(code.id, userId);

    if (existingRedemption) {
      throw new ConflictException("You have already redeemed this code");
    }

    // Execute redemption in a transaction
    const result = await this.transactions.run(async (tx) => {
      let creditsGranted: Decimal | null = null;
      let planGranted: string | null = null;
      let daysGranted: number | null = null;

      // Grant credits if applicable
      if (
        (code.type === "topup" || code.type === "both") &&
        code.creditAmount
      ) {
        creditsGranted = code.creditAmount;
        await this.codes.incrementUserBalance(userId, code.creditAmount, tx);

        // Create transaction record
        await this.codes.createTopupTransaction(
          userId,
          code.creditAmount,
          `code:${code.code}`,
          tx,
        );
      }

      // Grant subscription if applicable
      if (
        (code.type === "subscription" || code.type === "both") &&
        code.planId &&
        code.durationDays
      ) {
        planGranted = code.plan?.slug ?? null;
        daysGranted = code.durationDays;

        const periodStart = new Date();
        const periodEnd = new Date(
          Date.now() + code.durationDays * 24 * 60 * 60 * 1000,
        );

        // Upsert user subscription
        const existing = await this.codes.findSubscriptionByUserId(userId, tx);

        if (existing) {
          // Extend or upgrade the existing subscription
          const newEnd =
            existing.status === "active" &&
            existing.currentPeriodEnd > new Date()
              ? new Date(
                  existing.currentPeriodEnd.getTime() +
                    code.durationDays * 24 * 60 * 60 * 1000,
                )
              : periodEnd;

          await this.codes.updateSubscription(
            userId,
            {
              planId: code.planId,
              status: "active",
              currentPeriodStart: periodStart,
              currentPeriodEnd: newEnd,
              messagesUsed: 0,
              tokensUsed: 0,
            },
            tx,
          );
        } else {
          await this.codes.createSubscription(
            userId,
            {
              planId: code.planId,
              status: "active",
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
            },
            tx,
          );
        }
      }

      // Increment times redeemed
      await this.codes.incrementTimesRedeemed(code.id, tx);

      // Create redemption record
      await this.codes.createRedemption(
        code.id,
        userId,
        { creditsGranted, planGranted, daysGranted },
        tx,
      );

      return { creditsGranted, planGranted, daysGranted };
    });

    return {
      success: true,
      creditsGranted: result.creditsGranted
        ? Number(result.creditsGranted)
        : null,
      planGranted: result.planGranted,
      daysGranted: result.daysGranted,
    };
  }

  /**
   * Get redemption history for a user
   */
  async getHistory(userId: string) {
    const redemptions = await this.codes.findRedemptionsByUser(userId);

    return { redemptions };
  }

  /**
   * Admin: Create an invitation code
   */
  async createCode(dto: CreateCodeDto, createdById?: string) {
    const code = dto.code || this.generateCode();

    // Validate type-specific fields
    if ((dto.type === "topup" || dto.type === "both") && !dto.creditAmount) {
      throw new BadRequestException(
        "creditAmount is required for topup or both type codes",
      );
    }

    if (
      (dto.type === "subscription" || dto.type === "both") &&
      (!dto.planId || !dto.durationDays)
    ) {
      throw new BadRequestException(
        "planId and durationDays are required for subscription or both type codes",
      );
    }

    // Verify plan exists if specified
    if (dto.planId) {
      const plan = await this.codes.findPlanById(dto.planId);
      if (!plan) {
        throw new NotFoundException("Subscription plan not found");
      }
    }

    const created = await this.codes.createCode({
      code,
      type: dto.type,
      creditAmount: dto.creditAmount ?? null,
      planId: dto.planId ?? null,
      durationDays: dto.durationDays ?? null,
      maxRedemptions: dto.maxRedemptions,
      createdById: createdById ?? null,
    });

    return { code: created };
  }

  /**
   * Admin: List all codes with usage stats
   */
  async listCodes(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [codes, total] = await Promise.all([
      this.codes.listCodes(skip, limit),
      this.codes.countCodes(),
    ]);

    return { codes, total, page, limit };
  }

  /**
   * Admin: Update a code (deactivate, change max redemptions)
   */
  async updateCode(
    id: string,
    data: { isActive?: boolean; maxRedemptions?: number },
  ) {
    const code = await this.codes.findCodeById(id);
    if (!code) {
      throw new NotFoundException("Code not found");
    }

    const updated = await this.codes.updateCode(id, data);

    return { code: updated };
  }
}
