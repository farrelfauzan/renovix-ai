import { ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { CheckoutLimits } from "../types/checkout-limits";
import type { NumericPaymentSetting } from "../types/numeric-payment-setting";
import { isPaymentsForcedOff } from "../utils/is-payments-forced-off";

/**
 * The payment settings (RNX-35, docs/payments.md section 6), read on every use so a change applies without a deploy.
 * No value is set in code: payments are off until `paymentsEnabled` is true, PAYMENTS_FORCE_OFF=true wins over it, a
 * checkout is refused while a limit or the expiry is not set, and the reconciliation job runs only once its interval is.
 */
@Injectable()
export class PaymentSettingsService {
  constructor(private readonly settings: PlatformSettingsService) {}

  /** True only when PAYMENTS_FORCE_OFF is not "true" and `paymentsEnabled` is true. */
  async isEnabled(): Promise<boolean> {
    if (isPaymentsForcedOff(process.env)) return false;
    return (await this.settings.getSetting("paymentsEnabled")) === true;
  }

  /** 403 unless the pilot allow-list is not set, empty, or lists the user (AC23). */
  async assertAllowedUser(userId: string): Promise<void> {
    const allowed = await this.settings.getSetting("paymentsAllowedUserIds");
    if (allowed && allowed.length > 0 && !allowed.includes(userId)) {
      throw new ForbiddenException("Payments are open to pilot accounts only for now; use an invitation code");
    }
  }

  /** The limits and the order expiry; 503 naming the first one that is not set. */
  async getCheckoutLimits(): Promise<CheckoutLimits> {
    return {
      maxPerPaymentRupiah: await this.requireSetting("paymentsMaxPerPaymentRupiah"),
      maxPerAccountPerDayRupiah: await this.requireSetting("paymentsMaxPerAccountPerDayRupiah"),
      maxPlatformPerDayRupiah: await this.requireSetting("paymentsMaxPlatformPerDayRupiah"),
      orderExpiryMinutes: await this.requireSetting("paymentsOrderExpiryMinutes"),
    };
  }

  /** The reconciliation interval in minutes; null while it is not set (the job does not run). */
  getReconcileEveryMinutes(): Promise<number | null> {
    return this.settings.getSetting("paymentsReconcileEveryMinutes");
  }

  private async requireSetting(name: NumericPaymentSetting): Promise<number> {
    const value = await this.settings.getSetting(name);
    if (value === null) throw new ServiceUnavailableException(`Payments are not configured: ${name} is not set`);
    return value;
  }
}
