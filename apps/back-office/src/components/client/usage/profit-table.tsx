"use client";

import { formatAmount } from "@/lib/usage/format-amount";
import { formatUsdIdr } from "@/lib/usage/format-usd-idr";
import type { ProfitReportRow } from "@/lib/usage/profit-report-row";

const HEADERS = ["Day", "Provider", "Model", "Tier", "Wallet", "Package", "Cost, low", "Cost, high (estimate)", "Revenue", "Profit, low", "Profit, high (estimate)", "Net margin, low", "Net margin, high"];

/** Cost, revenue, profit and margin per day, provider, model, tier, wallet and package, as the API aggregated them. */
export function ProfitTable({ rows }: { rows: readonly ProfitReportRow[] }) {
  return (
    <div className="overflow-x-auto rounded-rx border border-rx-line">
      <table className="w-full min-w-[1200px] text-left text-sm">
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
              <td className="px-3 py-2">{row.wallet}</td>
              <td className="px-3 py-2">{row.packageVersionId ?? row.topUpPackVersionId ?? "none"}</td>
              <td className="px-3 py-2 font-mono">{formatUsdIdr(row.costLowUsd, row.costLowIdr)}</td>
              <td className="px-3 py-2 font-mono">{formatUsdIdr(row.costHighUsd, row.costHighIdr)}</td>
              <td className="px-3 py-2 font-mono">{formatUsdIdr(row.revenueUsd, row.revenueIdr)}</td>
              <td className="px-3 py-2 font-mono">{formatUsdIdr(row.profitLowUsd, row.profitLowIdr)}</td>
              <td className="px-3 py-2 font-mono">{formatUsdIdr(row.profitHighUsd, row.profitHighIdr)}</td>
              <td className="px-3 py-2 font-mono">{formatAmount(row.netMarginLow, "margin")}</td>
              <td className="px-3 py-2 font-mono">{formatAmount(row.netMarginHigh, "margin")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
