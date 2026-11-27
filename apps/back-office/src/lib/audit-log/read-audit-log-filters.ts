import type { AuditLogFilters } from "./audit-log-filters";

/** The applied filters of the audit log screen from the page URL's query (RX-371); a filter the URL lacks is "". */
export function readAuditLogFilters(params: Pick<URLSearchParams, "get">): AuditLogFilters {
  return {
    adminId: params.get("adminId") ?? "",
    resource: params.get("resource") ?? "",
    action: params.get("action") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
}
