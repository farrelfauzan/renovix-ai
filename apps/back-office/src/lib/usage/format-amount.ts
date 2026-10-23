const NOT_SET = "not set";
const DISPLAY_DECIMALS = 6;
const MARGIN_PERCENT = 100;

/** A decimal string with at most 6 decimals (the API's scale), trailing zeros dropped; derived figures can carry many more. */
const trimDecimals = (value: string): string => String(Number(Number(value).toFixed(DISPLAY_DECIMALS)));

/** How a decimal string from the API is shown: `usd` and `idr` with their currency, `margin` (a fraction) as a percentage; null is "not set". */
export function formatAmount(value: string | null, unit: "usd" | "idr" | "margin"): string {
  if (value === null) return NOT_SET;
  if (unit === "usd") return `US$${trimDecimals(value)}`;
  if (unit === "idr") return `Rp${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
  return `${(Number(value) * MARGIN_PERCENT).toFixed(1)}%`;
}
