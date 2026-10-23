import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";

/** The CSV export of one day (RNX-35, AC19) and the audit change that records it. */
export type OrdersExport = {
  readonly csv: string;
  readonly change: AdminAuditChange;
};
