/**
 * Cost, revenue, profit and margin of a set of calls (RNX-228), amounts as decimal strings.
 * - cost: our low and high estimates over the calls whose cost is known; the unknown counts are left out, never 0;
 * - revenue (gross, PPN included): credits consumed x the purchase snapshot's price per credit; calls with no snapshot
 *   are counted in revenueUnknown*;
 * - PPN = revenue x 11 / 111; gateway fee = revenue x the fee percentage; net revenue = revenue - PPN - fee;
 * - profit low = net revenue - high cost, profit high = net revenue - low cost; net margin = profit / net revenue (rupiah).
 * Every figure that needs the gateway fee is null while the setting has no value; a margin is null on 0 net revenue.
 */
export type MoneyFigures = {
  readonly calls: number;
  readonly creditsConsumed: string;
  readonly costLowUsd: string;
  readonly costHighUsd: string;
  readonly costUnknownUsdCalls: number;
  readonly costLowIdr: string;
  readonly costHighIdr: string;
  readonly costUnknownIdrCalls: number;
  readonly revenueIdr: string;
  readonly revenueUsd: string;
  readonly revenueUnknownCalls: number;
  readonly revenueUnknownCredits: string;
  readonly ppnIdr: string;
  readonly ppnUsd: string;
  readonly gatewayFeeIdr: string | null;
  readonly gatewayFeeUsd: string | null;
  readonly netRevenueIdr: string | null;
  readonly netRevenueUsd: string | null;
  readonly profitLowIdr: string | null;
  readonly profitHighIdr: string | null;
  readonly profitLowUsd: string | null;
  readonly profitHighUsd: string | null;
  readonly netMarginLow: string | null;
  readonly netMarginHigh: string | null;
};
