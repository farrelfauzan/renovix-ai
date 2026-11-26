"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import type { AuditLogFilters } from "@/lib/audit-log/audit-log-filters";
import { buildAuditLogPresetRange } from "@/lib/audit-log/build-audit-log-preset-range";

const FIELDS = [
  { name: "adminId", label: "Admin id", type: "text" },
  { name: "resource", label: "Resource", type: "text" },
  { name: "action", label: "Action", type: "text" },
  { name: "from", label: "From", type: "datetime-local" },
  { name: "to", label: "To", type: "datetime-local" },
] as const;

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
] as const;

/** The audit log filters (RX-164), starting from `initial`; `onApply` gets them when the form is submitted or a last-days preset is chosen (RX-371). */
export function AuditLogFiltersForm({ initial, onApply }: { initial: AuditLogFilters; onApply: (filters: AuditLogFilters) => void }) {
  const [filters, setFilters] = useState<AuditLogFilters>(initial);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply(filters);
  };
  const applyPreset = (days: number) => {
    const preset = { ...filters, ...buildAuditLogPresetRange(days) };
    setFilters(preset);
    onApply(preset);
  };
  return (
    <form aria-label="Audit log filters" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      {FIELDS.map(({ name, label, type }) => (
        <label key={name} className="flex flex-col gap-1 text-sm">
          {label}
          <Input
            type={type}
            value={filters[name]}
            onChange={(event) => setFilters({ ...filters, [name]: event.target.value })}
            className="rounded-rx border border-rx-line px-2 py-1 h-auto text-sm"
          />
        </label>
      ))}
      <Button variant="outline" type="submit" className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
        Apply filters
      </Button>
      {PRESETS.map(({ label, days }) => (
        <Button key={days} variant="outline" type="button" onClick={() => applyPreset(days)} className="rounded-rx border border-rx-line px-3 py-1 text-sm h-auto bg-transparent font-normal whitespace-normal">
          {label}
        </Button>
      ))}
    </form>
  );
}
