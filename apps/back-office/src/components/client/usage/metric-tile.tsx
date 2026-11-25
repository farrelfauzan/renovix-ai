"use client";

/** One figure of the totals, as a KPI tile of the design canvas (RNX-315): a label and the value as shown. */
export function MetricTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-rx border border-rx-line px-3.5 py-3">
      <dt className="text-xs text-rx-muted">{label}</dt>
      <dd className="break-words font-mono text-[15px] font-medium">{value}</dd>
      {note && <dd className="text-xs text-rx-muted">{note}</dd>}
    </div>
  );
}
