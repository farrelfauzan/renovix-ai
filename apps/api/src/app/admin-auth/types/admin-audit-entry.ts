import type { AdminAuditValues } from "./admin-audit-values";

/** One row of `admin_audit_log` as written (RX-97); `createdAt` is set by the database. */
export type AdminAuditEntry = {
  readonly adminId: string;
  readonly resource: string;
  readonly action: string;
  readonly before: AdminAuditValues;
  readonly after: AdminAuditValues;
  readonly reason: string;
  readonly requestId: string;
  readonly effectiveAt: Date;
};
