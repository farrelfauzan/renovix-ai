import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ViolationRecord } from "../dto/guardrail-result.dto";

@Injectable()
export class ViolationTrackerService {
  private readonly logger = new Logger(ViolationTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log a guardrail violation for analytics purposes only.
   * This never blocks or bans the user — it's purely for observability.
   */
  async logViolation(record: ViolationRecord): Promise<void> {
    try {
      await this.prisma.guardrailViolation.create({
        data: {
          userId: record.userId,
          agentId: record.agentId,
          type: record.type,
          severity: record.severity,
          input: record.input?.slice(0, 1000),
          output: record.output?.slice(0, 1000),
          action: "logged",
          metadata: record.metadata || undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to log violation: ${err}`);
    }
  }
}
