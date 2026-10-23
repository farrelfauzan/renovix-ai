import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PaymentReconciliationService } from "../service/payment-reconciliation.service";
import { PaymentSettingsService } from "../service/payment-settings.service";

const MINUTE_MS = 60_000;

/**
 * Runs the payment reconciliation every `paymentsReconcileEveryMinutes` (RNX-35): a tick every minute that runs the job
 * when that many minutes have passed since this instance last ran it. Not set: the job does not run.
 */
@Injectable()
export class PaymentReconciliationScheduler {
  private readonly logger = new Logger(PaymentReconciliationScheduler.name);
  private lastRunAt: number | null = null;

  constructor(
    private readonly paymentSettings: PaymentSettingsService,
    private readonly reconciliation: PaymentReconciliationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runWhenDue(): Promise<void> {
    const everyMinutes = await this.paymentSettings.getReconcileEveryMinutes();
    const now = Date.now();
    if (everyMinutes === null) return;
    if (this.lastRunAt !== null && Math.round((now - this.lastRunAt) / MINUTE_MS) < everyMinutes) return;
    this.lastRunAt = now;
    const summary = await this.reconciliation.reconcile();
    if (summary.claimed > 0) this.logger.log(`Payment reconciliation: ${summary.claimed} order(s) checked ${JSON.stringify(summary.outcomes)}`);
  }
}
