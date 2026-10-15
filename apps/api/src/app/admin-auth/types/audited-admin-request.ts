import type { AdminAuditContext } from "./admin-audit-context";
import type { AdminRequest } from "./admin-request";

/** A request on a route that declares `@AdminAudit({ resource, action })`, inside its audit transaction (RX-97). */
export type AuditedAdminRequest = AdminRequest & { audit: AdminAuditContext };
