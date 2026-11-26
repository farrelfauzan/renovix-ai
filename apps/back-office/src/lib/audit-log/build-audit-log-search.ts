import type { AuditLogFilters } from "./audit-log-filters";

/**
 * The query string of the audit log page URL (RX-371): the filters that are set, as the form holds them
 * (`from` and `to` stay `datetime-local` values). "" when none is set.
 */
export function buildAuditLogSearch(filters: AuditLogFilters): string {
  const entries = Object.entries(filters).filter(([, value]) => value !== "");
  const query = new URLSearchParams(entries).toString();
  return query ? `?${query}` : "";
}
