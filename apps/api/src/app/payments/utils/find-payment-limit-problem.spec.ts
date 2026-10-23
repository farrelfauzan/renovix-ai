import { findPaymentLimitProblem } from "./find-payment-limit-problem";

// RNX-35 AC8: each limit is named; the values are test values (R-20 proposals), not the Tech Lead's.
const LIMITS = { maxPerPaymentRupiah: 500_000, maxPerAccountPerDayRupiah: 1_000_000, maxPlatformPerDayRupiah: 5_000_000, orderExpiryMinutes: 15 };
const input = (overrides = {}) => ({
  amountRupiah: 100_000,
  limits: LIMITS,
  providerMinRupiah: 1,
  providerMaxRupiah: 10_000_000,
  accountTodayRupiah: 0,
  platformTodayRupiah: 0,
  ...overrides,
});

describe("findPaymentLimitProblem (RNX-35)", () => {
  it("within every limit, also exactly at each: null", () => {
    expect(findPaymentLimitProblem(input())).toBeNull();
    expect(findPaymentLimitProblem(input({ amountRupiah: 500_000, accountTodayRupiah: 500_000, platformTodayRupiah: 4_500_000 }))).toBeNull();
  });

  it.each([
    ["below the provider's minimum", { amountRupiah: 0 }, "provider's minimum"],
    ["above the provider's maximum", { providerMaxRupiah: 99_999 }, "provider's maximum"],
    ["one rupiah above maxPerPaymentRupiah", { amountRupiah: 500_001 }, "paymentsMaxPerPaymentRupiah"],
    ["the account's day one rupiah over", { accountTodayRupiah: 900_001 }, "paymentsMaxPerAccountPerDayRupiah"],
    ["the platform's day one rupiah over", { platformTodayRupiah: 4_900_001 }, "paymentsMaxPlatformPerDayRupiah"],
  ])("%s: names the limit", (_case, overrides, name) => {
    expect(findPaymentLimitProblem(input(overrides))).toContain(name);
  });
});
