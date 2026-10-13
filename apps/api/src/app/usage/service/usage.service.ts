import { Injectable, Logger } from "@nestjs/common";
import type { Decimal } from "@prisma/client/runtime/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface LogUsageParams {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: Decimal;
  latencyMs: number;
  provider: string;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logUsage(params: LogUsageParams): Promise<void> {
    await this.prisma.usageLog.create({
      data: {
        userId: params.userId,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cost: params.cost,
        latencyMs: params.latencyMs,
        provider: params.provider,
      },
    });
  }

  async getUsageByUser(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      model?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const where: any = { userId };

    if (options?.model) {
      where.model = options.model;
    }
    if (options?.startDate || options?.endDate) {
      where.createdAt = {};
      if (options.startDate) where.createdAt.gte = options.startDate;
      if (options.endDate) where.createdAt.lte = options.endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.usageLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
      }),
      this.prisma.usageLog.count({ where }),
    ]);

    return { logs, total };
  }
}
