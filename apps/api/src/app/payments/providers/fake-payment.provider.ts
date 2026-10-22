import { verifySignature } from "../../channel/utils/verify-signature";
import { FAKE_PROVIDER_LIMITS } from "../config/fake-provider-limits";
import { FAKE_SIGNATURE_HEADER } from "../config/fake-signature-header";
import { FakeWebhookBodyDto } from "../dto/fake-webhook-body.dto";
import type { ChargeRequest } from "../types/charge-request";
import type { CreatedCharge } from "../types/created-charge";
import type { FakeCharge } from "../types/fake-charge";
import type { FakeProviderOptions } from "../types/fake-provider-options";
import type { PaymentProvider } from "../types/payment-provider";
import type { ProviderPaymentState } from "../types/provider-payment-state";
import type { ProviderPaymentStatus } from "../types/provider-payment-status";
import type { SimulatedPayment } from "../types/simulated-payment";
import type { WebhookRequest } from "../types/webhook-request";
import type { WebhookVerification } from "../types/webhook-verification";
import { fakeReferenceOf } from "../utils/fake-reference-of";

const NOT_VERIFIED: WebhookVerification = { isVerified: false };

/**
 * The fake payment provider (RNX-35): the default in tests and local development, and the only provider of 35a. No
 * network, no money: charges live in this instance's memory with deterministic references (`fake_<orderId>`).
 * A test pays with `simulatePaid` (fake only, no route calls it); webhooks are verified with real HMAC-SHA256 bytes
 * under the configured key (none configured: nothing verifies).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly minAmountRupiah: number;
  readonly maxAmountRupiah: number;
  private readonly charges = new Map<string, FakeCharge>();
  private readonly webhookSecret: string;
  private isNextChargeFailing = false;

  constructor(options: FakeProviderOptions = {}) {
    this.webhookSecret = options.webhookSecret ?? "";
    this.minAmountRupiah = options.minAmountRupiah ?? FAKE_PROVIDER_LIMITS.minAmountRupiah;
    this.maxAmountRupiah = options.maxAmountRupiah ?? FAKE_PROVIDER_LIMITS.maxAmountRupiah;
  }

  /** Holds a pending charge for the order; throws once after `failNextCharge`. */
  async createCharge(request: ChargeRequest): Promise<CreatedCharge> {
    if (this.isNextChargeFailing) {
      this.isNextChargeFailing = false;
      throw new Error("Fake provider: the charge was refused");
    }
    const providerRef = fakeReferenceOf(request.orderId);
    this.charges.set(providerRef, { amountRupiah: request.amountRupiah, state: "pending", paidAmountRupiah: null, paidAt: null });
    return { providerRef, paymentCode: `fake-qris:${providerRef}`, expiresAt: request.expiresAt };
  }

  /** The charge's state; unknown for a reference this instance never created. */
  async getStatus(providerRef: string): Promise<ProviderPaymentStatus> {
    const charge = this.charges.get(providerRef);
    if (!charge) return { state: "unknown", amountRupiah: null, paidAt: null };
    return { state: charge.state, amountRupiah: charge.paidAmountRupiah, paidAt: charge.paidAt };
  }

  /** Marks the charge cancelled. */
  async cancel(providerRef: string): Promise<void> {
    this.setState(providerRef, "cancelled");
  }

  /** Verifies `x-fake-signature` (hex HMAC-SHA256 of the raw body under the key), then reads the body. */
  async verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    const signature = request.headers[FAKE_SIGNATURE_HEADER];
    if (typeof signature !== "string" || !verifySignature(request.rawBody, signature, this.webhookSecret)) return NOT_VERIFIED;
    const parsed = FakeWebhookBodyDto.safeParse(this.parseJson(request.rawBody));
    if (!parsed.success) return NOT_VERIFIED;
    const { reference, status, amountRupiah } = parsed.data;
    return { isVerified: true, providerRef: reference, reportedState: status, reportedAmountRupiah: amountRupiah };
  }

  /** Tests only: the order's charge is paid, with its own amount unless another is given. */
  simulatePaid(orderId: string, payment: SimulatedPayment = {}): void {
    const providerRef = fakeReferenceOf(orderId);
    const charge = this.findCharge(providerRef);
    this.charges.set(providerRef, {
      ...charge,
      state: "paid",
      paidAmountRupiah: payment.amountRupiah ?? charge.amountRupiah,
      paidAt: payment.paidAt ?? new Date(),
    });
  }

  /** Tests only: the order's charge reports this state (expired, cancelled, unknown or pending). */
  simulateState(orderId: string, state: ProviderPaymentState): void {
    this.setState(fakeReferenceOf(orderId), state);
  }

  /** Tests only: the next createCharge throws, as a provider that is down would. */
  failNextCharge(): void {
    this.isNextChargeFailing = true;
  }

  private setState(providerRef: string, state: ProviderPaymentState): void {
    this.charges.set(providerRef, { ...this.findCharge(providerRef), state });
  }

  private findCharge(providerRef: string): FakeCharge {
    const charge = this.charges.get(providerRef);
    if (!charge) throw new Error(`Fake provider: no charge ${providerRef}`);
    return charge;
  }

  private parseJson(rawBody: Buffer): unknown {
    try {
      return JSON.parse(rawBody.toString("utf8"));
    } catch {
      return undefined;
    }
  }
}
