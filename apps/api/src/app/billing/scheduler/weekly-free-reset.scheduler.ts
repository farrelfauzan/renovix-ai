import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { WeeklyFreeResetService } from "../service/weekly-free-reset.service";

/**
 * RNX-321: every Monday at 00:00 Asia/Jakarta, the weekly reset of the free allowance. Safe on several instances: each
 * wallet is reset under its row lock and once per ISO week (WeeklyFreeResetService).
 */
@Injectable()
export class WeeklyFreeResetScheduler {
  private readonly logger = new Logger(WeeklyFreeResetScheduler.name);

  constructor(private readonly weeklyFreeReset: WeeklyFreeResetService) {}

  /** Runs the reset for the current week and logs how many wallets this instance reset. */
  @Cron("0 0 * * 1", { timeZone: "Asia/Jakarta" })
  async resetWeeklyFreeWallets(): Promise<void> {
    const written = await this.weeklyFreeReset.resetWeeklyFreeWallets(new Date());
    this.logger.log(`Weekly free reset: ${written} wallet(s) reset by this instance`);
  }
}
