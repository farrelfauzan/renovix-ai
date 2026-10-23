import { Logger } from "@nestjs/common";
import { verifySignature } from "../../channel/utils/verify-signature";
import { AUTOGOPAY_API } from "../config/autogopay-api";
import { AUTOGOPAY_LIMITS } from "../config/autogopay-limits";
import { AUTOGOPAY_QRIS_PAYMENT_METHOD } from "../config/autogopay-qris-payment-method";
import { AUTOGOPAY_SIGNATURE_HEADER } from "../config/autogopay-signature-header";
import { AUTOGOPAY_STATUS_STATES } from "../config/autogopay-status-states";
import { AUTOGOPAY_WEBHOOK_STATES } from "../config/autogopay-webhook-states";
import { AutoGoPayEnvelopeDto } from "../dto/autogopay-envelope.dto";
import { AutoGoPayGenerateResponseDto } from "../dto/autogopay-generate-response.dto";
import { AutoGoPayStatusResponseDto } from "../dto/autogopay-status-response.dto";
import { AutoGoPayWebhookBodyDto } from "../dto/autogopay-webhook-body.dto";
import type { AutoGoPayProviderOptions } from "../types/autogopay-provider-options";
import type { AutoGoPayResponse } from "../types/autogopay-response";
import type { AutoGoPayTransport } from "../types/autogopay-transport";
import type { ChargeRequest } from "../types/charge-request";
import type { CreatedCharge } from "../types/created-charge";
import type { PaymentProvider } from "../types/payment-provider";
import type { ProviderPaymentState } from "../types/provider-payment-state";
import type { ProviderPaymentStatus } from "../types/provider-payment-status";
import type { StatusCheckOptions } from "../types/status-check-options";
import type { WebhookRequest } from "../types/webhook-request";
import type { WebhookVerification } from "../types/webhook-verification";
import { parseAutoGoPayDate } from "../utils/parse-autogopay-date";
import { errorNameOf } from "../utils/error-name-of";

const NOT_VERIFIED: WebhookVerification = { isVerified: false };
const IGNORED: WebhookVerification = { isVerified: true, isIgnored: true };
const UNKNOWN_STATUS: ProviderPaymentStatus = { state: "unknown", amountRupiah: null, paidAt: null };

/**
 * The AutoGoPay QRIS adapter (RNX-229, docs/payments.md section 1): a dynamic QRIS per order through the API with a
 * Bearer key, statuses mapped to the five states, webhooks verified with HMAC-SHA256 of the raw body keyed with the
 * same API key. Every answer is read from `data` inside the documented envelope `{ success, message, data }`, and only
 * when the HTTP status is 2xx and `success` is true (RNX-273); date-times without an offset are read as WIB (D285).
 * Only GoPay QRIS webhooks are handled; another product's (another `payment_method`) is ignored. Never retries; a
 * failed call throws an error that names only the path, the HTTP status or the error's class: never the key, a
 * signature or a body. The two log lines (a signed webhook body it cannot read; an ignored payment method, named)
 * name none of them.
 */
export class AutoGoPayProvider implements PaymentProvider {
  readonly name = "autogopay";
  readonly minAmountRupiah = AUTOGOPAY_LIMITS.minAmountRupiah;
  readonly maxAmountRupiah = AUTOGOPAY_LIMITS.maxAmountRupiah;
  private readonly apiKey: string;
  private readonly transport: AutoGoPayTransport;
  private readonly logger = new Logger(AutoGoPayProvider.name);

  constructor(options: AutoGoPayProviderOptions) {
    this.apiKey = options.apiKey;
    this.transport = options.transport;
  }

  /**
   * A dynamic QRIS for the exact amount (`/qris/generate`); throws on any answer that is not accepted, or whose `data`
   * lacks the fields or carries an expiry it cannot read. The API documents no merchant reference in the request, so
   * the order id is not sent (R-20 section 3.1).
   */
  async createCharge(request: ChargeRequest): Promise<CreatedCharge> {
    const response = await this.post(AUTOGOPAY_API.generatePath, { amount: request.amountRupiah });
    const parsed = AutoGoPayGenerateResponseDto.safeParse(this.readAcceptedEnvelope(response)?.data);
    const expiresAt = parsed.success ? parseAutoGoPayDate(parsed.data.expiry_time) : null;
    if (!parsed.success || expiresAt === null) throw this.refusal(AUTOGOPAY_API.generatePath, response);
    return { providerRef: parsed.data.transaction_id, paymentCode: parsed.data.qr_string, expiresAt };
  }

  /**
   * The payment's state (`/qris/status`), within `timeoutMs` (10 s by default): the status from `data.transaction_status`
   * when present, else `data.status`. Unknown for `success: false`, a status it cannot map, a body it cannot read, or a
   * settlement without an amount (the amount cannot be checked against the order, and the core would close the order
   * as amount_mismatch for good; unknown keeps it for the next check); throws on a non-2xx answer or a failed call.
   */
  async getStatus(providerRef: string, options: StatusCheckOptions = {}): Promise<ProviderPaymentStatus> {
    const response = await this.post(AUTOGOPAY_API.statusPath, { transaction_id: providerRef }, options.timeoutMs);
    if (!this.isSuccess(response)) throw this.refusal(AUTOGOPAY_API.statusPath, response);
    const parsed = AutoGoPayStatusResponseDto.safeParse(this.readAcceptedEnvelope(response)?.data);
    if (!parsed.success) return UNKNOWN_STATUS;
    const { transaction_status, status, amount, paid_at } = parsed.data;
    const state = this.stateOf(AUTOGOPAY_STATUS_STATES, transaction_status ?? status);
    if (state === "paid" && amount == null) return UNKNOWN_STATUS;
    return { state, amountRupiah: amount ?? null, paidAt: parseAutoGoPayDate(paid_at) };
  }

  /** Cancels the QRIS (`/qris/cancel`); throws on a failed call or an answer that is not accepted. */
  async cancel(providerRef: string): Promise<void> {
    const response = await this.post(AUTOGOPAY_API.cancelPath, { transaction_id: providerRef });
    if (!this.readAcceptedEnvelope(response)) throw this.refusal(AUTOGOPAY_API.cancelPath, response);
  }

  /**
   * Verifies `x-signature` (hex HMAC-SHA256 of the raw body under the API key, constant time), then reads the body. A
   * `payment_method` other than QRIS (another AutoGoPay product on the same key) is ignored; a missing or null one is QRIS.
   */
  async verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    const signature = request.headers[AUTOGOPAY_SIGNATURE_HEADER];
    if (typeof signature !== "string" || !verifySignature(request.rawBody, signature, this.apiKey)) return NOT_VERIFIED;
    const parsed = AutoGoPayWebhookBodyDto.safeParse(this.parseJson(request.rawBody));
    if (!parsed.success) {
      this.logger.warn("AutoGoPay webhook: the signature is valid but the body is not the expected shape (not recorded)");
      return NOT_VERIFIED;
    }
    const { transaction_id, status, amount } = parsed.data.transaction;
    const paymentMethod = parsed.data.transaction.payment_method ?? AUTOGOPAY_QRIS_PAYMENT_METHOD;
    if (paymentMethod !== AUTOGOPAY_QRIS_PAYMENT_METHOD) return this.ignoreWebhook(paymentMethod);
    return { isVerified: true, providerRef: transaction_id, reportedState: this.stateOf(AUTOGOPAY_WEBHOOK_STATES, status), reportedAmountRupiah: amount ?? null };
  }

  /** One call within the total timeout; a transport failure is rethrown with only the path and the error's class. */
  private async post(path: string, body: Readonly<Record<string, unknown>>, timeoutMs: number = AUTOGOPAY_API.totalTimeoutMs): Promise<AutoGoPayResponse> {
    try {
      return await this.transport.post(path, body, { timeoutMs });
    } catch (err) {
      throw new Error(`AutoGoPay ${path}: the request failed (${errorNameOf(err)})`);
    }
  }

  private isSuccess(response: AutoGoPayResponse): boolean {
    return response.status >= 200 && response.status < 300;
  }

  /** The envelope of an accepted answer (a 2xx whose envelope says `success: true`); null for any other answer. */
  private readAcceptedEnvelope(response: AutoGoPayResponse): AutoGoPayEnvelopeDto | null {
    const envelope = AutoGoPayEnvelopeDto.safeParse(response.body);
    return this.isSuccess(response) && envelope.data?.success === true ? envelope.data : null;
  }

  /** A genuine webhook about another product: one log line naming only the method; nothing recorded (RNX-273). */
  private ignoreWebhook(paymentMethod: string): WebhookVerification {
    this.logger.warn(`AutoGoPay webhook: payment_method ${JSON.stringify(paymentMethod)} is not QRIS (ignored, not recorded)`);
    return IGNORED;
  }

  private refusal(path: string, response: AutoGoPayResponse): Error {
    return new Error(`AutoGoPay ${path}: unexpected answer (HTTP ${response.status})`);
  }

  private stateOf(states: Readonly<Record<string, ProviderPaymentState>>, status: string | undefined): ProviderPaymentState {
    return status !== undefined && Object.hasOwn(states, status) ? states[status] : "unknown";
  }

  private parseJson(rawBody: Buffer): unknown {
    try {
      return JSON.parse(rawBody.toString("utf8"));
    } catch {
      return undefined;
    }
  }
}
