/** The payment settings a checkout needs set (RNX-35): the three caps and the order expiry. */
export type NumericPaymentSetting =
  | "paymentsMaxPerPaymentRupiah"
  | "paymentsMaxPerAccountPerDayRupiah"
  | "paymentsMaxPlatformPerDayRupiah"
  | "paymentsOrderExpiryMinutes";
