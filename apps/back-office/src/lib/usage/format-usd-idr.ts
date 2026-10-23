import { formatAmount } from "./format-amount";

/** A dollar amount with its rupiah amount, "US$0.5 · Rp8.000"; "not set" when the API has no value (null). */
export function formatUsdIdr(usd: string | null, idr: string | null): string {
  return usd === null || idr === null ? formatAmount(null, "usd") : `${formatAmount(usd, "usd")} · ${formatAmount(idr, "idr")}`;
}
