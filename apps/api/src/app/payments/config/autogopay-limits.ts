/** AutoGoPay's own amount limits for a QRIS charge, in rupiah (RNX-229, R-20 section 3.1: Rp1 to Rp10.000.000). */
export const AUTOGOPAY_LIMITS = {
  minAmountRupiah: 1,
  maxAmountRupiah: 10_000_000,
} as const;
