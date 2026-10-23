import type { ProviderPaymentState } from "./provider-payment-state";

/** A provider's answer to a status check (RNX-35): the state, the amount it says was paid and when, null when it reported none. */
export type ProviderPaymentStatus = {
  readonly state: ProviderPaymentState;
  readonly amountRupiah: number | null;
  readonly paidAt: Date | null;
};
