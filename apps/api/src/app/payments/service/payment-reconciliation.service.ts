import { Inject, Injectable } from "@nestjs/common";
import type { PaymentOrder } from "@generated/prisma/client.js";
import { PAYMENT_PROVIDER } from "../config/payment-provider.token";
import { RECONCILE_BATCH } from "../config/reconcile-batch";
import { PaymentOrderRepository } from "../repository/payment-order.repository";
import type { CheckOutcome } from "../types/check-outcome";
import type { PaymentProvider } from "../types/payment-provider";
import type { ReconcileSummary } from "../types/reconcile-summary";
import { PaymentSettingsService } from "./payment-settings.service";
import { PaymentSettlementService } from "./payment-settlement.service";

const MINUTE_MS = 60_000;

/**
 * The reconciliation run (RNX-35, docs/payments.md section 4): the pending orders past their expiry or named by a
 * webhook get a status check through the settlement path (paid: the same grant, flagged webhook_missed when no webhook
 * came, late when paid after expiry; expired or cancelled: closed; unknown: counted, review after 3). Safe on several
 * instances: rows are claimed with FOR UPDATE SKIP LOCKED and a claim time, and the grant's conditional update and
 * idempotency key stop a double grant even if two checks of one order overlap. Nothing runs while payments are off.
 */
@Injectable()
export class PaymentReconciliationService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly orders: PaymentOrderRepository,
    private readonly settlement: PaymentSettlementService,
  ) {}

  /** Claims one batch and checks each order; the outcomes, counted. */
  async reconcile(): Promise<ReconcileSummary> {
    if (!(await this.paymentSettings.isEnabled())) return { isPaused: true, claimed: 0, outcomes: {} };
    const now = new Date();
    const claimed = await this.orders.claimForReconcile({
      provider: this.provider.name,
      now,
      claimUntil: new Date(now.getTime() + RECONCILE_BATCH.claimMinutes * MINUTE_MS),
      limit: RECONCILE_BATCH.size,
    });
    const outcomes: Partial<Record<CheckOutcome, number>> = {};
    for (const order of claimed) {
      const outcome = await this.checkClaimed(order);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    return { isPaused: false, claimed: claimed.length, outcomes };
  }

  /** One claimed order's check; the claim is released afterwards, also when the check throws. */
  private async checkClaimed(order: PaymentOrder): Promise<CheckOutcome> {
    try {
      return await this.settlement.checkOrder(order, { source: "reconcile", actorId: null, note: null, reportedState: null });
    } finally {
      await this.orders.releaseClaim(order.id);
    }
  }
}
