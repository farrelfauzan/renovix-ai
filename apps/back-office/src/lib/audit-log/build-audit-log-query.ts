import type { AuditLogFilters } from "./audit-log-filters";

/**
 * The query string of the audit log routes (RX-164): the filters that are set, `from` and `to` turned
 * into ISO times with a time zone (the API refuses others), and the page cursor when given. "" when empty.
 */
export function buildAuditLogQuery(filters: AuditLogFilters, cursor?: string | null): string {
  const entries: [string, string][] = [
    ["adminId", filters.adminId.trim()],
    ["resource", filters.resource.trim()],
    ["action", filters.action.trim()],
    ["from", filters.from ? new Date(filters.from).toISOString() : ""],
    ["to", filters.to ? new Date(filters.to).toISOString() : ""],
    ["cursor", cursor ?? ""],
  ];
  const query = new URLSearchParams(entries.filter(([, value]) => value !== "")).toString();
  return query ? `?${query}` : "";
}
