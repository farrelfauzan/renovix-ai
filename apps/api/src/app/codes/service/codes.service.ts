import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Decimal } from "@prisma/client/runtime/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCodeDto } from "../dto/redeem-code.dto";

@Injectable()
export class CodesService {
  constructor(private readonly prisma: PrismaService) {}

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
    const code = await this.prisma.invitationCode.findUnique({
      where: { code: codeString },
      include: { plan: true },
    });

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
    const existingRedemption = await this.prisma.codeRedemption.findUnique({
      where: { codeId_userId: { codeId: code.id, userId } },
    });

    if (existingRedemption) {
      throw new ConflictException("You have already redeemed this code");
    }

    // Execute redemption in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      let creditsGranted: Decimal | null = null;
      let planGranted: string | null = null;
      let daysGranted: number | null = null;

      // Grant credits if applicable
      if (
        (code.type === "topup" || code.type === "both") &&
        code.creditAmount
      ) {
        creditsGranted = code.creditAmount;
        await tx.user.update({
          where: { id: userId },
          data: {
            balance: { increment: code.creditAmount },
          },
        });

        // Create transaction record
        await tx.transaction.create({
          data: {
            userId,
            amount: code.creditAmount,
            type: "topup",
            status: "success",
            reference: `code:${code.code}`,
          },
        });
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
        const existing = await tx.userSubscription.findUnique({
          where: { userId },
        });

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

          await tx.userSubscription.update({
            where: { userId },
            data: {
              planId: code.planId,
              status: "active",
              currentPeriodStart: periodStart,
              currentPeriodEnd: newEnd,
              messagesUsed: 0,
              tokensUsed: 0,
            },
          });
        } else {
          await tx.userSubscription.create({
            data: {
              userId,
              planId: code.planId,
              status: "active",
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
            },
          });
        }
      }

      // Increment times redeemed
      await tx.invitationCode.update({
        where: { id: code.id },
        data: { timesRedeemed: { increment: 1 } },
      });

      // Create redemption record
      await tx.codeRedemption.create({
        data: {
          codeId: code.id,
          userId,
          creditsGranted,
          planGranted,
          daysGranted,
        },
      });

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
    const redemptions = await this.prisma.codeRedemption.findMany({
      where: { userId },
      include: {
        code: { select: { code: true, type: true } },
      },
      orderBy: { redeemedAt: "desc" },
    });

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
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: dto.planId },
      });
      if (!plan) {
        throw new NotFoundException("Subscription plan not found");
      }
    }

    const created = await this.prisma.invitationCode.create({
      data: {
        code,
        type: dto.type,
        creditAmount: dto.creditAmount ?? null,
        planId: dto.planId ?? null,
        durationDays: dto.durationDays ?? null,
        maxRedemptions: dto.maxRedemptions,
        createdById: createdById ?? null,
      },
      include: { plan: true },
    });

    return { code: created };
  }

  /**
   * Admin: List all codes with usage stats
   */
  async listCodes(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [codes, total] = await Promise.all([
      this.prisma.invitationCode.findMany({
        include: {
          plan: { select: { slug: true, name: true } },
          _count: { select: { redemptions: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
      this.prisma.invitationCode.count(),
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
    const code = await this.prisma.invitationCode.findUnique({
      where: { id },
    });
    if (!code) {
      throw new NotFoundException("Code not found");
    }

    const updated = await this.prisma.invitationCode.update({
      where: { id },
      data,
    });

    return { code: updated };
  }
}
