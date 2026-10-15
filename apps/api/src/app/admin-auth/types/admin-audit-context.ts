import type { DbTransaction } from "../../prisma/db-transaction";
import type { AdminAuditChange } from "./admin-audit-change";

/**
 * What `AdminAuditInterceptor` gives the handler of an audited route on `request.audit` (RX-97): the
 * transaction every write of the handler must use, and `record` for the change the audit row describes.
 */
export type AdminAuditContext = {
  readonly tx: DbTransaction;
  readonly record: (change: AdminAuditChange) => void;
};
