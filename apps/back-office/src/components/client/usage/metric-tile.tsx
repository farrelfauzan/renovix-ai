"use client";

/** One figure of the totals: a label and the value as shown. */
export function MetricTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-rx border border-rx-line px-3 py-2">
      <dt className="text-xs text-rx-muted">{label}</dt>
      <dd className="break-words font-mono text-sm">{value}</dd>
      {note && <dd className="text-xs text-rx-muted">{note}</dd>}
    </div>
  );
}
