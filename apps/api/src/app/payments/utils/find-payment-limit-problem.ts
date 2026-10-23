import type { PaymentLimitInput } from "../types/payment-limit-input";

/**
 * The first limit a checkout's amount breaks, named, or null (RNX-35): the provider's minimum and maximum, the
 * per-payment setting, then the account's and the platform's daily caps (today's pending and paid orders plus this one).
 */
export function findPaymentLimitProblem(input: PaymentLimitInput): string | null {
  const { amountRupiah, limits } = input;
  if (amountRupiah < input.providerMinRupiah) return "the amount is below the payment provider's minimum";
  if (amountRupiah > input.providerMaxRupiah) return "the amount is above the payment provider's maximum";
  if (amountRupiah > limits.maxPerPaymentRupiah) return "the amount is above paymentsMaxPerPaymentRupiah";
  if (input.accountTodayRupiah + amountRupiah > limits.maxPerAccountPerDayRupiah) return "this account has reached paymentsMaxPerAccountPerDayRupiah for today";
  if (input.platformTodayRupiah + amountRupiah > limits.maxPlatformPerDayRupiah) return "the platform has reached paymentsMaxPlatformPerDayRupiah for today";
  return null;
}
