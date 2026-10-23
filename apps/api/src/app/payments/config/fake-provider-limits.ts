/** The fake provider's default amount limits, in rupiah (RNX-35): the same as AutoGoPay's (Rp1 to Rp10.000.000). */
export const FAKE_PROVIDER_LIMITS = {
  minAmountRupiah: 1,
  maxAmountRupiah: 10_000_000,
} as const;
