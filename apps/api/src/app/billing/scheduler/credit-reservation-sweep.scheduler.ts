import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CreditService } from "../service/credit.service";

/**
 * The expiry sweep (RX-22, docs/credits.md section 3.1 rule 8): every minute it releases the open reservations past
 * their expiresAt (a killed request). Safe on several instances: each reservation is closed by a conditional update.
 */
@Injectable()
export class CreditReservationSweepScheduler {
  private readonly logger = new Logger(CreditReservationSweepScheduler.name);

  constructor(private readonly credits: CreditService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepExpiredReservations(): Promise<void> {
    const expired = await this.credits.expireOverdueReservations();
    if (expired > 0) this.logger.log(`Released ${expired} expired credit reservation(s)`);
  }
}
