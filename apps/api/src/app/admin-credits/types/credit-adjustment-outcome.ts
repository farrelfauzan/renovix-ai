import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";
import type { CreditAdjustmentView } from "./credit-adjustment-view";

/** What a credit adjustment returns (RNX-227): the response body and the change its audit row records. */
export type CreditAdjustmentOutcome = {
  readonly result: CreditAdjustmentView;
  readonly change: AdminAuditChange;
};
