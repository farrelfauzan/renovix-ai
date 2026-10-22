import type { ChargeRequest } from "./charge-request";
import type { CreatedCharge } from "./created-charge";
import type { ProviderPaymentStatus } from "./provider-payment-status";
import type { WebhookRequest } from "./webhook-request";
import type { WebhookVerification } from "./webhook-verification";

/**
 * One payment provider (RNX-35, docs/payments.md section 1). Everything provider-specific lives behind this contract:
 * the core knows only references, rupiah amounts and the five states. An adapter:
 * - applies its own network timeouts (AutoGoPay: 5 s connect, 10 s total) and never retries `createCharge` itself; a
 *   thrown error from `createCharge` fails the order, from `getStatus` counts as an unknown answer;
 * - maps the provider's statuses to ProviderPaymentState (e.g. "settlement" to paid; anything else it cannot map to unknown);
 * - verifies a webhook on the raw body bytes (e.g. HMAC-SHA256 with its secret, compared in constant time) and never
 *   logs the secret, the signature or the body.
 */
export interface PaymentProvider {
  /** The name stored on every order (PAYMENT_PROVIDER), e.g. "fake". */
  readonly name: string;
  /** The smallest amount the provider accepts, in rupiah. */
  readonly minAmountRupiah: number;
  /** The largest amount the provider accepts, in rupiah. */
  readonly maxAmountRupiah: number;
  /** Creates the charge for an order; called once per order. */
  createCharge(request: ChargeRequest): Promise<CreatedCharge>;
  /** The payment's current state, by the provider's reference. */
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  /** Cancels a charge that will not be used. */
  cancel(providerRef: string): Promise<void>;
  /** Checks a webhook call's signature over its raw body, and reads what it reports. */
  verifyWebhook(request: WebhookRequest): Promise<WebhookVerification>;
}
