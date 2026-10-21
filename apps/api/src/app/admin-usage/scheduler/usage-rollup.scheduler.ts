import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { UsageAggregatesService } from "../service/usage-aggregates.service";

/**
 * The daily usage rollup (RNX-228): every day at 00:15 Asia/Jakarta it builds the closed days not built yet (yesterday,
 * and any day an earlier run missed). Safe on several instances: a day is built once, under an advisory lock.
 */
@Injectable()
export class UsageRollupScheduler {
  private readonly logger = new Logger(UsageRollupScheduler.name);

  constructor(private readonly aggregates: UsageAggregatesService) {}

  @Cron("15 0 * * *", { timeZone: "Asia/Jakarta" })
  async buildClosedDays(): Promise<void> {
    const built = await this.aggregates.buildClosedDays();
    if (built.length > 0) this.logger.log(`Built the usage rollups of ${built.length} day(s): ${built[0]} to ${built[built.length - 1]}`);
  }
}
