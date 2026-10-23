import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { PAYMENT_PROVIDER } from "../config/payment-provider.token";
import { PaymentOrderRepository } from "../repository/payment-order.repository";
import { PaymentUnmatchedPaymentRepository } from "../repository/payment-unmatched-payment.repository";
import { PaymentWebhookEventRepository } from "../repository/payment-webhook-event.repository";
import type { CheckOutcome } from "../types/check-outcome";
import type { PaymentProvider } from "../types/payment-provider";
import type { WebhookRequest } from "../types/webhook-request";
import { sha256Hex } from "../utils/sha256-hex";
import { PaymentSettlementService } from "./payment-settlement.service";

/**
 * The payment webhook (RNX-35, docs/payments.md section 3). The provider verifies the call on the raw body first (401,
 * nothing recorded, when it does not verify). A verified call is recorded with the SHA-256 of its raw body; one for an
 * unknown reference is also listed as an unmatched payment. A webhook never grants: for a known order it only starts a
 * status check through the settlement path, and while payments are off that check does not run (the reconciliation job
 * completes the order once they are on again).
 */
@Injectable()
export class PaymentWebhookService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly orders: PaymentOrderRepository,
    private readonly events: PaymentWebhookEventRepository,
    private readonly unmatched: PaymentUnmatchedPaymentRepository,
    private readonly settlement: PaymentSettlementService,
  ) {}

  /** Verifies, records and checks one webhook call; what the check did ("unmatched" for an unknown reference). */
  async receive(request: WebhookRequest): Promise<CheckOutcome | "unmatched"> {
    const verified = await this.provider.verifyWebhook(request);
    if (!verified.isVerified) throw new UnauthorizedException("Invalid webhook signature");
    const { providerRef, reportedState, reportedAmountRupiah } = verified;
    const order = await this.orders.findByReference(this.provider.name, providerRef);
    await this.events.create({ provider: this.provider.name, providerRef, orderId: order?.id ?? null, reportedStatus: reportedState, reportedAmountRupiah, bodySha256: sha256Hex(request.rawBody) });
    if (!order) {
      await this.unmatched.createIfAbsent({ provider: this.provider.name, providerRef, reason: "unknown_reference", amountRupiah: reportedAmountRupiah });
      return "unmatched";
    }
    const touched = await this.orders.touchWebhook(order.id, new Date());
    return this.settlement.checkOrder(touched, { source: "webhook", actorId: null, note: null, reportedState });
  }
}
