import type { AdminOrderView } from "./admin-order-view";
import type { OrderDayCounts } from "./order-day-counts";
import type { UnmatchedPaymentView } from "./unmatched-payment-view";

/** One Jakarta day of payments for the admin (RNX-35, AC19): the counts, the orders (filtered by state if asked) and the unmatched payments. */
export type AdminOrderDay = {
  readonly day: string;
  readonly counts: OrderDayCounts;
  readonly orders: readonly AdminOrderView[];
  readonly unmatched: readonly UnmatchedPaymentView[];
};
