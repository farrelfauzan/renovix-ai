import type { AuditLogFilters } from "./audit-log-filters";

/** No filter set: every audit row (RX-164). */
export const EMPTY_AUDIT_LOG_FILTERS: AuditLogFilters = { adminId: "", resource: "", action: "", from: "", to: "" };
