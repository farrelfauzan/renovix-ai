"use client";

import { formatAmount } from "@/lib/usage/format-amount";
import type { ReconciliationRow } from "@/lib/usage/reconciliation-row";

const HEADERS = ["Day", "Provider", "Portal balance", "Top-up", "Portal drop", "Our estimate, low", "Our estimate, high", "Flag"];

/** What the flag column says: flagged, within the threshold, or why it cannot be judged. */
const describeFlag = (flagged: boolean | null): string => (flagged === null ? "Not checked" : flagged ? "Flagged" : "Within threshold");

/** The entered provider days, each with its flag state. */
export function ReconciliationTable({ rows, providerNames }: { rows: readonly ReconciliationRow[]; providerNames: ReadonlyMap<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-rx border border-rx-line">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-rx-surface text-rx-muted">
          <tr>
            {HEADERS.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.providerId}|${row.day}`} className="border-t border-rx-line">
              <td className="px-3 py-2">{row.day}</td>
              <td className="px-3 py-2">{providerNames.get(row.providerId) ?? row.providerId}</td>
              <td className="px-3 py-2 font-mono">{formatAmount(row.portalBalanceUsd, "usd")}</td>
              <td className="px-3 py-2 font-mono">{formatAmount(row.topUpUsd, "usd")}</td>
              <td className="px-3 py-2 font-mono">{row.portalDropUsd === null ? "no previous day" : formatAmount(row.portalDropUsd, "usd")}</td>
              <td className="px-3 py-2 font-mono">{formatAmount(row.estimateLowUsd, "usd")}</td>
              <td className="px-3 py-2 font-mono">{formatAmount(row.estimateHighUsd, "usd")}</td>
              <td className={`px-3 py-2 ${row.flagged ? "font-medium text-rx-red-bar" : ""}`}>{describeFlag(row.flagged)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
