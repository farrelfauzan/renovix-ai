import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PaymentOrder } from "@generated/prisma/client.js";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PurchaseSnapshotService } from "../../offers/service/purchase-snapshot.service";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { MAX_UNKNOWN_CHECKS } from "../config/max-unknown-checks";
import { PAYMENT_PROVIDER } from "../config/payment-provider.token";
import { PaymentOrderChangeRepository } from "../repository/payment-order-change.repository";
import { PaymentOrderRepository } from "../repository/payment-order.repository";
import { PaymentUnmatchedPaymentRepository } from "../repository/payment-unmatched-payment.repository";
import type { CheckOutcome } from "../types/check-outcome";
import type { OrderChangeInput } from "../types/order-change-input";
import type { OrderCheck } from "../types/order-check";
import type { PaymentProvider } from "../types/payment-provider";
import type { ProviderPaymentStatus } from "../types/provider-payment-status";
import { errorNameOf } from "../utils/error-name-of";
import { paymentIdempotencyKey } from "../utils/payment-idempotency-key";
import { toPaidPurchaseInput } from "../utils/to-paid-purchase-input";
import { PaymentSettingsService } from "./payment-settings.service";

/**
 * The one path that settles an order (RNX-35, docs/payments.md section 3), shared by the webhook, the reconciliation
 * job and the admin's "confirm from provider". It asks the provider for the order's status and acts on the answer;
 * nothing else grants. A grant needs a paid status whose amount equals the order's, and is one transaction: the order
 * moves to paid once (a conditional update; a second caller finds it paid and stops), the purchase snapshot is written
 * with the provider reference as its payment id, and the ledger entry has that same reference (main's convention for a
 * purchase grant) and the key `payment:<provider>:<providerRef>` (a replay writes nothing). While payments are off it
 * checks nothing.
 */
@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly orders: PaymentOrderRepository,
    private readonly changes: PaymentOrderChangeRepository,
    private readonly unmatched: PaymentUnmatchedPaymentRepository,
    private readonly snapshots: PurchaseSnapshotService,
    private readonly ledger: CreditLedgerService,
    private readonly transactions: TransactionService,
  ) {}

  /** Checks the order's status with the provider (outside any transaction) and applies the answer. */
  async checkOrder(order: PaymentOrder, check: OrderCheck): Promise<CheckOutcome> {
    if (!order.providerRef) return "no_reference";
    if (!(await this.paymentSettings.isEnabled())) return "paused";
    const status = await this.queryStatus(order.id, order.providerRef);
    if (status.state === "paid") {
      return status.amountRupiah === order.amountRupiah ? this.grant(order, order.providerRef, status, check) : this.rejectAmount(order, order.providerRef, status, check);
    }
    if (status.state === "expired" || status.state === "cancelled") return this.close(order, status.state, check);
    if (status.state === "pending") return this.keepPending(order, check);
    return this.countUnknown(order, check);
  }

  /** The provider's answer; a thrown error counts as unknown (only the error's class is logged). */
  private async queryStatus(orderId: string, providerRef: string): Promise<ProviderPaymentStatus> {
    try {
      return await this.provider.getStatus(providerRef);
    } catch (err) {
      this.logger.warn(`Payment order ${orderId}: the status check failed (${errorNameOf(err)})`);
      return { state: "unknown", amountRupiah: null, paidAt: null };
    }
  }

  /** The grant transaction: paid once, the snapshot, the ledger entry. A failure in any write rolls all of them back. */
  private grant(order: PaymentOrder, providerRef: string, status: ProviderPaymentStatus, check: OrderCheck): Promise<CheckOutcome> {
    return this.transactions.run(async (tx) => {
      const paidAt = status.paidAt ?? new Date();
      const fromStatus = await this.orders.markPaid({ orderId: order.id, paidAt, isWebhookMissedWhenNone: check.source !== "webhook" }, tx);
      if (!fromStatus) return "already_settled";
      await this.recordChange({ orderId: order.id, event: "paid", fromStatus, toStatus: "paid" }, check, tx);
      const snapshot = await this.snapshots.recordPaidPurchase(toPaidPurchaseInput(order, providerRef), tx);
      if (snapshot.creditsGranted.isZero()) return "granted";
      await this.ledger.appendEntry(
        {
          owner: { userId: order.userId },
          wallet: "paid",
          type: order.packageVersionId ? "plan_grant" : "top_up",
          amount: snapshot.creditsGranted,
          memberUserId: order.userId,
          reference: providerRef,
          idempotencyKey: paymentIdempotencyKey(order.provider, providerRef),
        },
        tx,
      );
      return "granted";
    });
  }

  /** A paid answer with another amount: no grant, the order fails with amount_mismatch, and the payment is listed unmatched. */
  private rejectAmount(order: PaymentOrder, providerRef: string, status: ProviderPaymentStatus, check: OrderCheck): Promise<CheckOutcome> {
    return this.transactions.run(async (tx) => {
      const fromStatus = await this.orders.markAmountMismatch(order.id, tx);
      if (!fromStatus) return "already_settled";
      await this.recordChange({ orderId: order.id, event: "amount_mismatch", fromStatus, toStatus: "failed" }, check, tx);
      await this.unmatched.createIfAbsent({ provider: order.provider, providerRef, reason: "amount_mismatch", orderId: order.id, amountRupiah: status.amountRupiah }, tx);
      return "amount_mismatch";
    });
  }

  /** The provider says expired or cancelled: a pending order closes so (a later paid answer with its amount still grants it once, flagged late when after its expiry). */
  private close(order: PaymentOrder, state: "expired" | "cancelled", check: OrderCheck): Promise<CheckOutcome> {
    return this.transactions.run(async (tx) => {
      const fromStatus = await this.orders.moveStatus(order.id, ["pending"], state, tx);
      if (!fromStatus) return "already_settled";
      await this.recordChange({ orderId: order.id, event: state, fromStatus, toStatus: state }, check, tx);
      return state;
    });
  }

  /**
   * The provider says pending: after a webhook that said paid, the order is flagged unconfirmed; for the job, an order
   * still pending past its expiry counts as an unknown answer; otherwise nothing changes.
   */
  private async keepPending(order: PaymentOrder, check: OrderCheck): Promise<CheckOutcome> {
    if (check.reportedState === "paid") {
      await this.transactions.run(async (tx) => {
        if (await this.orders.flagUnconfirmed(order.id, tx)) await this.recordChange({ orderId: order.id, event: "unconfirmed", fromStatus: "pending", toStatus: "pending" }, check, tx);
      });
      return "unconfirmed";
    }
    if (check.source === "reconcile" && order.expiresAt < new Date()) return this.countUnknown(order, check);
    return "pending";
  }

  /** One more unknown answer: the order stays pending; at MAX_UNKNOWN_CHECKS it is listed for manual review. */
  private countUnknown(order: PaymentOrder, check: OrderCheck): Promise<CheckOutcome> {
    return this.transactions.run(async (tx) => {
      const result = await this.orders.countUnknownCheck(order.id, MAX_UNKNOWN_CHECKS, tx);
      if (!result) return "already_settled";
      const event = result.needsReview && result.unknownChecks === MAX_UNKNOWN_CHECKS ? "needs_review" : "unknown_status";
      await this.recordChange({ orderId: order.id, event, fromStatus: "pending", toStatus: "pending" }, check, tx);
      return result.needsReview ? "needs_review" : "unknown";
    });
  }

  private async recordChange(change: OrderChangeInput, check: OrderCheck, tx: DbTransaction): Promise<void> {
    await this.changes.create({ ...change, source: check.source, actorId: check.actorId, note: check.note }, tx);
  }
}
