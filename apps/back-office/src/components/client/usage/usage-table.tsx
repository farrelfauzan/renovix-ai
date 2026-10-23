"use client";

import type { UsageApi } from "@/lib/usage/usage-api";
import type { UsageReportRow } from "@/lib/usage/usage-report-row";
import { UsageUserCell } from "./usage-user-cell";

const HEADERS = ["Day", "Provider", "Model", "Tier", "Workspace or user", "Calls", "Tokens new", "Tokens cached", "Tokens out", "Tokens reasoning"];

/** The usage rows as the API aggregated them; no totals are computed here. */
export function UsageTable({ rows, api, canReveal }: { rows: readonly UsageReportRow[]; api: UsageApi; canReveal: boolean }) {
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
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-rx-line align-top">
              <td className="px-3 py-2">{row.day}</td>
              <td className="px-3 py-2">{row.providerId}</td>
              <td className="px-3 py-2">{row.providerModelId}</td>
              <td className="px-3 py-2">{row.tier}</td>
              <td className="px-3 py-2">{row.user ? <UsageUserCell user={row.user} api={api} canReveal={canReveal} /> : (row.workspaceId ?? "none")}</td>
              <td className="px-3 py-2 font-mono">{row.calls}</td>
              <td className="px-3 py-2 font-mono">{row.tokensNew}</td>
              <td className="px-3 py-2 font-mono">{row.tokensCached}</td>
              <td className="px-3 py-2 font-mono">{row.tokensOut}</td>
              <td className="px-3 py-2 font-mono">{row.tokensReasoning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
