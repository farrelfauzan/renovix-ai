import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";

/** What an audited admin-providers write returns (RX-177): the response body and the change its audit row records. */
export type Audited<T> = {
  readonly result: T;
  readonly change: AdminAuditChange;
};
