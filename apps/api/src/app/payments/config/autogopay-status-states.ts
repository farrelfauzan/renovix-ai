import type { ProviderPaymentState } from "../types/provider-payment-state";

/**
 * AutoGoPay's `/qris/status` statuses (RNX-229, R-20 section 3.1) and the state each maps to. Any other value is
 * `unknown`.
 */
export const AUTOGOPAY_STATUS_STATES: Readonly<Record<string, ProviderPaymentState>> = {
  settlement: "paid",
  pending: "pending",
  expire: "expired",
  cancel: "cancelled",
};
