import { Decimal } from "@prisma/client/runtime/client";
import { PPN_RATE } from "../config/ppn-rate";
import type { MoneyFigures } from "../types/money-figures";
import type { UsageMeasures } from "../types/usage-measures";
import { toAmount } from "./to-amount";

/** Decimals a net margin is rounded to. */
const MARGIN_DECIMALS = 6;
const HUNDRED = 100;

/** Gross minus PPN (gross x rate / (1 + rate), PPN included in the price) and the gateway fee; null without the fee. */
function netOf(gross: Decimal, feePercent: number | null): { ppn: Decimal; fee: Decimal | null; net: Decimal | null } {
  const ppn = gross.mul(PPN_RATE).div(PPN_RATE.plus(1));
  const fee = feePercent === null ? null : gross.mul(feePercent).div(HUNDRED);
  return { ppn, fee, net: fee === null ? null : gross.minus(ppn).minus(fee) };
}

/** profit / net, rounded; null without a net revenue or on 0. */
const marginOf = (profit: Decimal | null, net: Decimal | null): string | null =>
  profit === null || net === null || net.isZero() ? null : toAmount(profit.div(net).toDecimalPlaces(MARGIN_DECIMALS));
const amountOrNull = (value: Decimal | null): string | null => (value === null ? null : toAmount(value));

/**
 * Cost, revenue, profit and net margin of a set of calls (RNX-228), from their summed measures and the
 * paymentGatewayFeePercent setting (null while it has no value). The definitions are on MoneyFigures.
 */
export function toMoneyFigures(sums: UsageMeasures, feePercent: number | null): MoneyFigures {
  const idr = netOf(sums.revenueIdr, feePercent);
  const usd = netOf(sums.revenueUsd, feePercent);
  const profitLowIdr = idr.net && idr.net.minus(sums.costHighIdr);
  const profitHighIdr = idr.net && idr.net.minus(sums.costLowIdr);
  return {
    calls: sums.calls,
    creditsConsumed: toAmount(sums.creditsConsumed),
    costLowUsd: toAmount(sums.costLowUsd),
    costHighUsd: toAmount(sums.costHighUsd),
    costUnknownUsdCalls: sums.costUnknownUsdCalls,
    costLowIdr: toAmount(sums.costLowIdr),
    costHighIdr: toAmount(sums.costHighIdr),
    costUnknownIdrCalls: sums.costUnknownIdrCalls,
    revenueIdr: toAmount(sums.revenueIdr),
    revenueUsd: toAmount(sums.revenueUsd),
    revenueUnknownCalls: sums.revenueUnknownCalls,
    revenueUnknownCredits: toAmount(sums.revenueUnknownCredits),
    ppnIdr: toAmount(idr.ppn),
    ppnUsd: toAmount(usd.ppn),
    gatewayFeeIdr: amountOrNull(idr.fee),
    gatewayFeeUsd: amountOrNull(usd.fee),
    netRevenueIdr: amountOrNull(idr.net),
    netRevenueUsd: amountOrNull(usd.net),
    profitLowIdr: amountOrNull(profitLowIdr),
    profitHighIdr: amountOrNull(profitHighIdr),
    profitLowUsd: amountOrNull(usd.net && usd.net.minus(sums.costHighUsd)),
    profitHighUsd: amountOrNull(usd.net && usd.net.minus(sums.costLowUsd)),
    netMarginLow: marginOf(profitLowIdr, idr.net),
    netMarginHigh: marginOf(profitHighIdr, idr.net),
  };
}
