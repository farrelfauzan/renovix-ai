"use client";

import { useState } from "react";
import type { AuditLogApi } from "@/lib/audit-log/audit-log-api";
import type { AuditLogFilters } from "@/lib/audit-log/audit-log-filters";

const FILE_NAME = "audit-log.csv";

/** Downloads the CSV of every row matching the applied filters (RX-164); the API records the export. */
export function AuditLogExportButton({ api, filters }: { api: AuditLogApi; filters: AuditLogFilters }) {
  const [isExporting, setIsExporting] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const download = async () => {
    setIsExporting(true);
    setHasFailed(false);
    try {
      const url = URL.createObjectURL(await api.exportCsv(filters));
      const link = document.createElement("a");
      link.href = url;
      link.download = FILE_NAME;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setHasFailed(true);
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={download} disabled={isExporting} className="rounded-rx border border-rx-line px-3 py-1 text-sm">
        Export CSV
      </button>
      {hasFailed && <span role="alert" className="text-sm text-rx-red-bar">The export failed.</span>}
    </div>
  );
}
