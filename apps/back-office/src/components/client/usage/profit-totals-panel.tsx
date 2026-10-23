"use client";

import { formatAmount } from "@/lib/usage/format-amount";
import { formatUsdIdr } from "@/lib/usage/format-usd-idr";
import type { ProfitReport } from "@/lib/usage/profit-report";
import { MetricTile } from "./metric-tile";

/** The period's totals exactly as the API computed them (cost, revenue, fee, profit, margin, free-wallet cost). */
export function ProfitTotalsPanel({ report }: { report: ProfitReport }) {
  const { totals, paymentGatewayFeePercent } = report;
  const unknownCalls = Math.max(totals.costUnknownUsdCalls, totals.costUnknownIdrCalls);
  return (
    <div className="flex flex-col gap-2">
      <dl aria-label="Totals" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile label="Cost, low" value={formatUsdIdr(totals.costLowUsd, totals.costLowIdr)} />
        <MetricTile label="Cost, high (estimate)" value={formatUsdIdr(totals.costHighUsd, totals.costHighIdr)} />
        <MetricTile label="Credits consumed" value={totals.creditsConsumed} />
        <MetricTile label="Revenue, consumed credits" value={formatUsdIdr(totals.revenueUsd, totals.revenueIdr)} />
        <MetricTile label="Gateway fee" value={paymentGatewayFeePercent === null ? "not set" : `${paymentGatewayFeePercent}%`} note={formatUsdIdr(totals.gatewayFeeUsd, totals.gatewayFeeIdr)} />
        <MetricTile label="Net revenue" value={formatUsdIdr(totals.netRevenueUsd, totals.netRevenueIdr)} />
        <MetricTile label="Profit, low" value={formatUsdIdr(totals.profitLowUsd, totals.profitLowIdr)} />
        <MetricTile label="Profit, high (estimate)" value={formatUsdIdr(totals.profitHighUsd, totals.profitHighIdr)} />
        <MetricTile label="Net margin" value={`${formatAmount(totals.netMarginLow, "margin")} to ${formatAmount(totals.netMarginHigh, "margin")}`} />
        <MetricTile label="Free-wallet cost, low" value={formatUsdIdr(totals.freeWalletCostLowUsd, totals.freeWalletCostLowIdr)} note={`${totals.freeWalletCalls} calls`} />
        <MetricTile label="Free-wallet cost, high (estimate)" value={formatUsdIdr(totals.freeWalletCostHighUsd, totals.freeWalletCostHighIdr)} />
      </dl>
      {unknownCalls > 0 && <p className="text-xs text-rx-muted">{unknownCalls} calls have no known cost and are left out of the cost figures.</p>}
      {totals.revenueUnknownCalls > 0 && <p className="text-xs text-rx-muted">{totals.revenueUnknownCalls} calls have no purchase price and are left out of the revenue.</p>}
    </div>
  );
}
