import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `model_call_costs` (RNX-162): one row per call_id, only ever inserted. */
@Injectable()
export class ModelCallCostRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts a call's row once: a row already written for its call_id (a replayed usage entry) is kept and this one is
   * skipped (ON CONFLICT DO NOTHING). Never inside the usage entry's transaction.
   */
  async create(data: Prisma.ModelCallCostUncheckedCreateInput): Promise<void> {
    await this.prisma.modelCallCost.createMany({ data: [data], skipDuplicates: true });
  }
}
