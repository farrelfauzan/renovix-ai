"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@performa-ai/ui/components/button";
import type { AuditLogApi } from "@/lib/audit-log/audit-log-api";
import type { AuditLogFilters } from "@/lib/audit-log/audit-log-filters";
import type { AuditLogPage } from "@/lib/audit-log/audit-log-page";
import { defaultAuditLogApi } from "@/lib/audit-log/default-audit-log-api";
import { buildAuditLogSearch } from "@/lib/audit-log/build-audit-log-search";
import { readAuditLogFilters } from "@/lib/audit-log/read-audit-log-filters";
import { AuditLogCopyLinkButton } from "./audit-log-copy-link-button";
import { AuditLogEntryDialog } from "./audit-log-entry-dialog";
import { AuditLogExportButton } from "./audit-log-export-button";
import { AuditLogFiltersForm } from "./audit-log-filters-form";
import { AuditLogTable } from "./audit-log-table";

/**
 * The audit log screen (RX-164, PRD 09 F11): filters, the rows newest first 50 at a time, the next page
 * by the API's cursor, and the CSV export of the applied filters. The applied filters live in the URL (RX-371),
 * so a copied link opens the same view; a row opens its detail in a modal. `api` is replaced in tests only.
 */
export function AuditLogScreen({ api = defaultAuditLogApi }: { api?: AuditLogApi }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [initialFilters] = useState<AuditLogFilters>(() => readAuditLogFilters(searchParams));
  const [filters, setFilters] = useState<AuditLogFilters>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [hasFailed, setHasFailed] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
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
    void load(initialFilters, null);
  }, [load, initialFilters]);
  const openRow = page?.rows.find((row) => row.id === selectedId);
  const focusOpenButton = (id: string) => {
    const rows = Array.from(tableRef.current?.querySelectorAll<HTMLElement>("tr[data-audit-entry]") ?? []);
    rows.find((candidate) => candidate.dataset.auditEntry === id)?.querySelector("button")?.focus();
  };
  const apply = (applied: AuditLogFilters) => {
    setFilters(applied);
    router.replace(`${pathname}${buildAuditLogSearch(applied)}`);
    void load(applied, null);
  };
  return (
    <div className="mt-4 flex flex-col gap-4">
      <AuditLogFiltersForm initial={initialFilters} onApply={apply} />
      <div className="flex flex-wrap items-center gap-3">
        <AuditLogExportButton api={api} filters={filters} />
        <AuditLogCopyLinkButton filters={filters} />
      </div>
      {hasFailed && <p role="alert" className="text-sm text-rx-red-bar">The audit log could not be loaded.</p>}
      {page && (
        <div ref={tableRef}>
          <AuditLogTable rows={page.rows} selectedId={openRow?.id ?? null} onOpen={setSelectedId} />
        </div>
      )}
      {openRow && <AuditLogEntryDialog row={openRow} onClose={() => setSelectedId(null)} onReturnFocus={() => focusOpenButton(openRow.id)} />}
      {page?.nextCursor && (
        <Button variant="outline" type="button" onClick={() => load(filters, page.nextCursor)} className="self-start rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
          Next page
        </Button>
      )}
    </div>
  );
}
