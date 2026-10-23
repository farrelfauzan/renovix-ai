import type { ProviderPaymentState } from "./provider-payment-state";

/** One charge the fake provider holds in memory (RNX-35). */
export type FakeCharge = {
  readonly amountRupiah: number;
  readonly state: ProviderPaymentState;
  readonly paidAmountRupiah: number | null;
  readonly paidAt: Date | null;
};
