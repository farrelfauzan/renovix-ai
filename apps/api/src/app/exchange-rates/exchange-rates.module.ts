import { Module } from "@nestjs/common";
import { ExchangeRateService } from "./service/exchange-rate.service";

/**
 * The USD to IDR rate (RNX-53, D235, D237): refreshed lazily when a quote or purchase reads a rate fetched more than
 * RATE_REFRESH_AFTER_HOURS ago (no cron), and the rate a purchase is charged at. No controller of its own.
 */
@Module({
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRatesModule {}
