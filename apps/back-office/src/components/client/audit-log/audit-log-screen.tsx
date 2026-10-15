"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditLogApi } from "@/lib/audit-log/audit-log-api";
import type { AuditLogFilters } from "@/lib/audit-log/audit-log-filters";
import type { AuditLogPage } from "@/lib/audit-log/audit-log-page";
import { defaultAuditLogApi } from "@/lib/audit-log/default-audit-log-api";
import { EMPTY_AUDIT_LOG_FILTERS } from "@/lib/audit-log/empty-audit-log-filters";
import { AuditLogExportButton } from "./audit-log-export-button";
import { AuditLogFiltersForm } from "./audit-log-filters-form";
import { AuditLogTable } from "./audit-log-table";

/**
 * The audit log screen (RX-164, PRD 09 F11): filters, the rows newest first 50 at a time, the next page
 * by the API's cursor, and the CSV export of the applied filters. `api` is replaced in tests only.
 */
export function AuditLogScreen({ api = defaultAuditLogApi }: { api?: AuditLogApi }) {
  const [filters, setFilters] = useState<AuditLogFilters>(EMPTY_AUDIT_LOG_FILTERS);
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const load = useCallback(
    async (applied: AuditLogFilters, cursor: string | null) => {
      setHasFailed(false);
      try {
        setPage(await api.listPage(applied, cursor));
      } catch {
        setHasFailed(true);
      }
    },
    [api],
  );
  useEffect(() => {
    void load(EMPTY_AUDIT_LOG_FILTERS, null);
  }, [load]);
  const apply = (applied: AuditLogFilters) => {
    setFilters(applied);
    void load(applied, null);
  };
  return (
    <div className="mt-4 flex flex-col gap-4">
      <AuditLogFiltersForm onApply={apply} />
      <AuditLogExportButton api={api} filters={filters} />
      {hasFailed && <p role="alert" className="text-sm text-red-700">The audit log could not be loaded.</p>}
      {page && <AuditLogTable rows={page.rows} />}
      {page?.nextCursor && (
        <button type="button" onClick={() => load(filters, page.nextCursor)} className="self-start rounded border border-neutral-300 px-3 py-1 text-sm">
          Next page
        </button>
      )}
    </div>
  );
}
