import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { BUILT_IN_ROLES } from "../../admin-auth/config/built-in-roles";
import { AdminNotificationRepository } from "../../admin-auth/repository/admin-notification.repository";
import { FRANKFURTER_SOURCE } from "../config/frankfurter-source";
import { ExchangeRateRepository } from "../repository/exchange-rate.repository";
import type { PurchaseRate } from "../types/purchase-rate";
import type { RateRefreshResult } from "../types/rate-refresh-result";
import { fetchFrankfurterRate } from "../utils/fetch-frankfurter-rate";
import { isInRetryGap } from "../utils/is-in-retry-gap";
import { isRateTooOld } from "../utils/is-rate-too-old";
import { isRefreshDue } from "../utils/is-refresh-due";

const RATE_UNAVAILABLE_KIND = "exchange_rate_unavailable";
const PRICES_UNAVAILABLE = "Prices are unavailable: no current USD to IDR exchange rate";

/**
 * The USD to IDR rate (RNX-53, D235, D237): a rupiah price is the USD price x the latest stored rate. A quote or
 * purchase reads it with getPurchaseRate, which first refreshes it (lazily, once per instance at a time) when the
 * stored rate was fetched more than RATE_REFRESH_AFTER_HOURS ago or there is none (but not within
 * RATE_REFRESH_RETRY_AFTER_MINUTES of a failed refresh), and refuses (503) when no rate is recent enough. There is no
 * fallback rate.
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  /** The refresh in flight on this instance, shared by every caller that needs one; cleared when it settles. */
  private inFlightRefresh: Promise<RateRefreshResult> | null = null;
  /** When this instance's last refresh failed; null after a success. Instance memory is enough for this bound. */
  private lastFailedRefreshAt: Date | null = null;

  constructor(
    private readonly rates: ExchangeRateRepository,
    private readonly notifications: AdminNotificationRepository,
  ) {}

  /**
   * Fetches the latest rate and stores it (once per rate date and source, whichever instance runs first). When the
   * source times out, fails, or answers no positive numeric rate, it logs a warning, stores nothing and the
   * previous rate stays in use.
   */
  async refreshRate(): Promise<RateRefreshResult> {
    const fetched = await fetchFrankfurterRate();
    this.lastFailedRefreshAt = fetched.isFetched ? null : new Date();
    if (!fetched.isFetched) {
      this.logger.warn(`USD to IDR rate refresh from ${FRANKFURTER_SOURCE.name} failed: ${fetched.reason}. The previous rate stays in use.`);
      return { isStored: false, reason: fetched.reason };
    }
    const { base, quote, name: source } = FRANKFURTER_SOURCE;
    await this.rates.saveFetchedRate({ base, quote, rate: new Decimal(fetched.rate), rateDate: new Date(fetched.rateDate), fetchedAt: new Date(), source });
    return { isStored: true, rateDate: fetched.rateDate };
  }

  /**
   * The rate a quote or purchase is charged at: the latest stored rate, refreshed first when due. When there is
   * none, or it is more than MAX_RATE_AGE_DAYS old, it notifies the owners (one unread notification at a time,
   * written outside any purchase transaction so it survives the refusal) and throws 503.
   */
  async getPurchaseRate(): Promise<PurchaseRate> {
    const latest = await this.findCurrentRate();
    if (latest && !isRateTooOld({ rateDate: latest.rateDate, now: new Date() })) {
      return { rate: latest.rate, rateDate: latest.rateDate, source: latest.source };
    }
    await this.notifyRateUnavailable();
    throw new ServiceUnavailableException(PRICES_UNAVAILABLE);
  }

  /**
   * The latest stored rate, after at most one refresh (shared with concurrent callers) when it is missing or due one
   * and no refresh failed on this instance in the last RATE_REFRESH_RETRY_AFTER_MINUTES.
   */
  private async findCurrentRate() {
    const now = new Date();
    const latest = await this.rates.findLatest(FRANKFURTER_SOURCE.base, FRANKFURTER_SOURCE.quote);
    if (latest && !isRefreshDue({ fetchedAt: latest.fetchedAt, now })) return latest;
    if (isInRetryGap({ lastFailedAt: this.lastFailedRefreshAt, now })) return latest;
    const refreshed = await this.refreshOnce();
    return refreshed.isStored ? this.rates.findLatest(FRANKFURTER_SOURCE.base, FRANKFURTER_SOURCE.quote) : latest;
  }

  /** Single-flight: starts a refresh unless one is in flight on this instance, and gives every caller the same one. */
  private refreshOnce(): Promise<RateRefreshResult> {
    this.inFlightRefresh ??= this.refreshRate().finally(() => {
      this.inFlightRefresh = null;
    });
    return this.inFlightRefresh;
  }

  /** Records the owners' notification unless an unread one of the same kind exists. */
  private async notifyRateUnavailable(): Promise<void> {
    if (await this.notifications.findUnreadByKind(RATE_UNAVAILABLE_KIND)) return;
    await this.notifications.createPlatformAlert(BUILT_IN_ROLES.owner, RATE_UNAVAILABLE_KIND);
    this.logger.error(`${PRICES_UNAVAILABLE}; purchases are refused until a rate is stored.`);
  }
}
