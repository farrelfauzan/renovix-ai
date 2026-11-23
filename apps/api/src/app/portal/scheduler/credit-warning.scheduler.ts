import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CreditWarningService } from "../service/credit-warning.service";

/**
 * RNX-329: runs the run-out warning check at the start of every hour, in this process and outside every request (D332).
 * Safe on several instances: each warning is recorded and mailed once per purchase cycle (CreditWarningService).
 */
@Injectable()
export class CreditWarningScheduler {
  private readonly logger = new Logger(CreditWarningScheduler.name);

  constructor(private readonly warnings: CreditWarningService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runCheck(): Promise<void> {
    const queued = await this.warnings.runCheck();
    if (queued > 0) this.logger.log(`Run-out warning check: queued ${queued} warning email(s)`);
  }
}
