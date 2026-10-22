import { toCsvLine } from "../../admin-auth/utils/to-csv-line";
import { ORDERS_CSV_HEADER } from "../config/orders-csv-header";
import type { AdminOrderView } from "../types/admin-order-view";
import type { UnmatchedPaymentView } from "../types/unmatched-payment-view";

/**
 * The day's CSV (RNX-35, AC19): the header, one line per order, then one per unmatched payment (status "unmatched" or
 * "unmatched_refunded", its reason as the flag, no expiry). Cells are escaped against spreadsheet formulas (RX-164).
 */
export function toOrdersCsv(orders: readonly AdminOrderView[], unmatched: readonly UnmatchedPaymentView[]): string {
  const orderLines = orders.map((order) =>
    toCsvLine([order.orderId, order.providerRef ?? "", String(order.amountRupiah), order.createdAt, order.expiresAt, order.paidAt ?? "", order.lastWebhookAt ?? "", order.status, order.flags.join(" ")]),
  );
  const unmatchedLines = unmatched.map((payment) =>
    toCsvLine([
      payment.orderId ?? "",
      payment.providerRef,
      payment.amountRupiah === null ? "" : String(payment.amountRupiah),
      payment.createdAt,
      "",
      "",
      "",
      payment.status === "refunded" ? "unmatched_refunded" : "unmatched",
      payment.reason,
    ]),
  );
  return [toCsvLine([...ORDERS_CSV_HEADER]), ...orderLines, ...unmatchedLines].join("");
}
