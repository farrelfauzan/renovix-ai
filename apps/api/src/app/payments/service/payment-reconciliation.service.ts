import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PaymentOrder } from "@generated/prisma/client.js";
import { PAYMENT_PROVIDER } from "../config/payment-provider.token";
import { RECONCILE_BATCH } from "../config/reconcile-batch";
import { PaymentOrderRepository } from "../repository/payment-order.repository";
import type { PaymentProvider } from "../types/payment-provider";
import type { ReconcileOutcome } from "../types/reconcile-outcome";
import type { ReconcileSummary } from "../types/reconcile-summary";
import { errorNameOf } from "../utils/error-name-of";
import { PaymentSettingsService } from "./payment-settings.service";
import { PaymentSettlementService } from "./payment-settlement.service";

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

/**
 * The reconciliation run (RNX-35, docs/payments.md section 4): the pending orders past their expiry or named by a
 * webhook get a status check through the settlement path (paid: the same grant, flagged webhook_missed when no webhook
 * came, late when paid after expiry; expired or cancelled: closed; unknown: counted, review after 3). Safe on several
 * instances: rows are claimed with FOR UPDATE SKIP LOCKED and a claim time that holds until just before the next
 * interval's run (RNX-271), so each order is checked once per interval whichever instance runs; the grant's conditional
 * update and idempotency key stop a double grant even if two checks of one order overlap. Nothing runs while payments
 * are off.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly orders: PaymentOrderRepository,
    private readonly settlement: PaymentSettlementService,
  ) {}

  /**
   * Claims one batch and checks each order; the outcomes, counted. The run stops checking when less than
   * `checkBudgetSeconds` of its claim is left (RNX-271 review round 1): the rest keeps its claim and the next interval's
   * run takes it, so no order is checked twice in one interval even when a batch is slower than its claim.
   */
  async reconcile(): Promise<ReconcileSummary> {
    if (!(await this.paymentSettings.isEnabled())) return { isPaused: true, claimed: 0, outcomes: {} };
    const now = new Date();
    const claimUntil = await this.claimUntilOf(now);
    const claimed = await this.orders.claimForReconcile({ provider: this.provider.name, now, claimUntil, limit: RECONCILE_BATCH.size });
    const outcomes: Partial<Record<ReconcileOutcome, number>> = {};
    for (const order of claimed) {
      if (Date.now() + RECONCILE_BATCH.checkBudgetSeconds * SECOND_MS > claimUntil.getTime()) break;
      const outcome = await this.checkClaimed(order);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    return { isPaused: false, claimed: claimed.length, outcomes };
  }

  /**
   * Until when this run's claim holds (RNX-271): one interval minus the slack, so the next interval's run (on any
   * instance) finds the claim ended and a run in this interval does not; the fallback while the interval is not set.
   */
  private async claimUntilOf(now: Date): Promise<Date> {
    const everyMinutes = await this.paymentSettings.getReconcileEveryMinutes();
    const claimMs = everyMinutes === null
      ? RECONCILE_BATCH.fallbackClaimMinutes * MINUTE_MS
      : everyMinutes * MINUTE_MS - RECONCILE_BATCH.claimSlackSeconds * SECOND_MS;
    return new Date(now.getTime() + claimMs);
  }

  /**
   * One claimed order's check; the claim is kept until it ends, not released (RNX-271). A check that throws is logged
   * (the error's class only) and counted as "error", and the batch goes on: one failing order never stops the others
   * (review round 1); it is checked again at the next interval.
   */
  private async checkClaimed(order: PaymentOrder): Promise<ReconcileOutcome> {
    try {
      return await this.settlement.checkOrder(order, { source: "reconcile", actorId: null, note: null, reportedState: null });
    } catch (err) {
      this.logger.error(`Payment order ${order.id}: the reconciliation check failed (${errorNameOf(err)})`);
      return "error";
    }
  }
}
