"use client";

import { formatUsdIdr } from "@/lib/usage/format-usd-idr";
import type { ProfitReport } from "@/lib/usage/profit-report";

/** Credits sold per day and package; the value is what the API labels it ("list value, not cash"). */
export function CreditsSoldTable({ creditsSold }: { creditsSold: ProfitReport["creditsSold"] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">Credits sold ({creditsSold.label})</h3>
      <div className="overflow-x-auto rounded-rx border border-rx-line">
        <table className="w-full min-w-[500px] text-left text-sm">
          <thead className="bg-rx-surface text-rx-muted">
            <tr>
              {["Day", "Package", "Entries", "Credits sold", "Value"].map((header) => (
                <th key={header} className="px-3 py-2 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {creditsSold.rows.map((row, index) => (
              <tr key={index} className="border-t border-rx-line">
                <td className="px-3 py-2">{row.day}</td>
                <td className="px-3 py-2">{row.packageVersionId ?? row.topUpPackVersionId ?? "none"}</td>
                <td className="px-3 py-2 font-mono">{row.entries}</td>
                <td className="px-3 py-2 font-mono">{row.creditsSold}</td>
                <td className="px-3 py-2 font-mono">{formatUsdIdr(row.listValueUsd, row.listValueIdr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
