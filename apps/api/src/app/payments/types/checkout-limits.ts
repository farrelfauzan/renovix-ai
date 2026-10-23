/** The checkout limits and the order expiry, from the platform settings (RNX-35); checkout is refused while one is not set. */
export type CheckoutLimits = {
  readonly maxPerPaymentRupiah: number;
  readonly maxPerAccountPerDayRupiah: number;
  readonly maxPlatformPerDayRupiah: number;
  readonly orderExpiryMinutes: number;
};
