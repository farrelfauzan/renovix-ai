import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";
import type { UnmatchedPaymentView } from "./unmatched-payment-view";

/** An unmatched payment marked refunded (RNX-35): the response body and the change its audit row records. */
export type AuditedUnmatchedPayment = {
  readonly result: UnmatchedPaymentView;
  readonly change: AdminAuditChange;
};
