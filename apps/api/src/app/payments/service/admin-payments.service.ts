import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AdminAuditLogRepository } from "../../admin-auth/repository/admin-audit-log.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { PAYMENTS_PAUSED_MESSAGE } from "../config/payments-paused-message";
import { PaymentOrderRepository } from "../repository/payment-order.repository";
import { PaymentUnmatchedPaymentRepository } from "../repository/payment-unmatched-payment.repository";
import type { AdminOrderDay } from "../types/admin-order-day";
import type { AuditedUnmatchedPayment } from "../types/audited-unmatched-payment";
import type { ConfirmOutcomeView } from "../types/confirm-outcome-view";
import type { ConfirmRequest } from "../types/confirm-request";
import type { OrderListState } from "../types/order-list-state";
import type { OrdersExport } from "../types/orders-export";
import type { RefundRequest } from "../types/refund-request";
import { jakartaDayRange } from "../utils/jakarta-day-range";
import { toAdminOrderView } from "../utils/to-admin-order-view";
import { toOrdersCsv } from "../utils/to-orders-csv";
import { toUnmatchedPaymentView } from "../utils/to-unmatched-payment-view";
import { PaymentSettlementService } from "./payment-settlement.service";

/**
 * Manual reconciliation (RNX-35, AC19, AC20, docs/payments.md section 5): a day's orders with counts and its CSV
 * (credits:read), "confirm from provider" for one order (the same settlement path as the webhook and the job), and
 * "mark unmatched as refunded" with a note (credits:adjust, re-authenticated). Every action is audited.
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly orders: PaymentOrderRepository,
    private readonly unmatched: PaymentUnmatchedPaymentRepository,
    private readonly settlement: PaymentSettlementService,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** The Jakarta day's counts by state and flag, its orders (only `state`'s when given) and its unmatched payments. */
  async listDay(day: string, state: OrderListState | null): Promise<AdminOrderDay> {
    const range = jakartaDayRange(day);
    const [counts, orders, unmatched] = await Promise.all([this.orders.countCreatedIn(range), this.orders.findCreatedIn(range, state), this.unmatched.findCreatedIn(range)]);
    const listedUnmatched = state === null || state === "unmatched" ? unmatched : [];
    return { day, counts: { ...counts, unmatched: unmatched.length }, orders: orders.map(toAdminOrderView), unmatched: listedUnmatched.map(toUnmatchedPaymentView) };
  }

  /** The day's CSV (every order, then every unmatched payment) and the change its audit row records. */
  async exportDay(day: string): Promise<OrdersExport> {
    const { orders, unmatched } = await this.listDay(day, null);
    return { csv: toOrdersCsv(orders, unmatched), change: { before: {}, after: { day, orders: orders.length, unmatched: unmatched.length } } };
  }

  /**
   * Asks the provider for the order's status and applies it through the settlement path (a matching settlement grants
   * once), then writes the audit row in its own short transaction: no transaction is open during the provider call.
   * 404 for an unknown order; 503 while payments are off (nothing is checked or granted).
   */
  async confirmFromProvider(request: ConfirmRequest): Promise<ConfirmOutcomeView> {
    const { adminId, orderId, reason, requestId } = request;
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException("Order not found");
    const outcome = await this.settlement.checkOrder(order, { source: "admin", actorId: adminId, note: reason, reportedState: null });
    if (outcome === "paused") throw new ServiceUnavailableException(PAYMENTS_PAUSED_MESSAGE);
    const after = await this.orders.findById(orderId);
    const status = after?.status ?? order.status;
    await this.transactions.run((tx) =>
      this.auditLog.create(
        { adminId, resource: "payment_order", action: "confirm", before: { orderId, status: order.status }, after: { orderId, status, outcome }, reason, requestId, effectiveAt: new Date() },
        tx,
      ),
    );
    return { orderId, outcome, status };
  }

  /** Marks an open unmatched payment refunded with the admin's note, in the audit transaction; 404 unknown, 409 already refunded. */
  async markUnmatchedRefunded(request: RefundRequest, tx: DbTransaction): Promise<AuditedUnmatchedPayment> {
    const { adminId, unmatchedId, note } = request;
    const before = await this.unmatched.findById(unmatchedId, tx);
    if (!before) throw new NotFoundException("Unmatched payment not found");
    if (!(await this.unmatched.markRefunded(unmatchedId, { adminId, at: new Date(), note }, tx))) throw new ConflictException("This payment is already marked refunded");
    const after = await this.unmatched.findById(unmatchedId, tx);
    const result = toUnmatchedPaymentView(after ?? before);
    return { result, change: { before: { unmatchedId, status: before.status }, after: { unmatchedId, status: result.status, providerRef: result.providerRef }, reason: note } };
  }
}
