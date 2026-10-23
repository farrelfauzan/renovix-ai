import type { ProviderPaymentState } from "./provider-payment-state";

/**
 * A provider's verdict on a webhook call (RNX-35): not verified, or verified with the reference, state and amount the
 * call reports. What a webhook reports is only a reason to check; it never grants anything by itself.
 */
export type WebhookVerification =
  | { readonly isVerified: false }
  | {
      readonly isVerified: true;
      readonly providerRef: string;
      readonly reportedState: ProviderPaymentState;
      readonly reportedAmountRupiah: number | null;
    };
