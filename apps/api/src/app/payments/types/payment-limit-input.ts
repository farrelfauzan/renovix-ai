import type { CheckoutLimits } from "./checkout-limits";

/** One checkout's amount against the limits (RNX-35): the setting limits, the provider's own, and today's totals so far. */
export type PaymentLimitInput = {
  readonly amountRupiah: number;
  readonly limits: CheckoutLimits;
  readonly providerMinRupiah: number;
  readonly providerMaxRupiah: number;
  readonly accountTodayRupiah: number;
  readonly platformTodayRupiah: number;
};
