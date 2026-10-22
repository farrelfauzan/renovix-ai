"use client";

import { useState, type FormEvent } from "react";
import type { AuditLogFilters } from "@/lib/audit-log/audit-log-filters";
import { EMPTY_AUDIT_LOG_FILTERS } from "@/lib/audit-log/empty-audit-log-filters";

const FIELDS = [
  { name: "adminId", label: "Admin id", type: "text" },
  { name: "resource", label: "Resource", type: "text" },
  { name: "action", label: "Action", type: "text" },
  { name: "from", label: "From", type: "datetime-local" },
  { name: "to", label: "To", type: "datetime-local" },
] as const;

/** The audit log filters (RX-164); `onApply` gets them when the form is submitted. */
export function AuditLogFiltersForm({ onApply }: { onApply: (filters: AuditLogFilters) => void }) {
  const [filters, setFilters] = useState<AuditLogFilters>(EMPTY_AUDIT_LOG_FILTERS);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply(filters);
  };
  return (
    <form aria-label="Audit log filters" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      {FIELDS.map(({ name, label, type }) => (
        <label key={name} className="flex flex-col gap-1 text-sm">
          {label}
          <input
            type={type}
            value={filters[name]}
            onChange={(event) => setFilters({ ...filters, [name]: event.target.value })}
            className="rounded-rx border border-rx-line px-2 py-1"
          />
        </label>
      ))}
      <button type="submit" className="rounded-rx border border-rx-line px-3 py-1 text-sm">
        Apply filters
      </button>
    </form>
  );
}
