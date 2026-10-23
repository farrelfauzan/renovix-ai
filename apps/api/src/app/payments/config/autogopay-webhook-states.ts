import type { ProviderPaymentState } from "../types/provider-payment-state";
import { AUTOGOPAY_STATUS_STATES } from "./autogopay-status-states";

/**
 * The statuses an AutoGoPay webhook may report (RNX-229): the documented webhook says `PAID` (R-20 section 3.1),
 * plus the status endpoint's own values. Any other value is `unknown`. What a webhook reports never grants by itself.
 */
export const AUTOGOPAY_WEBHOOK_STATES: Readonly<Record<string, ProviderPaymentState>> = {
  ...AUTOGOPAY_STATUS_STATES,
  PAID: "paid",
};
