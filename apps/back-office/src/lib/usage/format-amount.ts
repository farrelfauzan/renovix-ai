const NOT_SET = "not set";

/** How a decimal string from the API is shown: `usd` and `idr` with their currency, `margin` (a fraction) as a percentage; null is "not set". */
export function formatAmount(value: string | null, unit: "usd" | "idr" | "margin"): string {
  if (value === null) return NOT_SET;
  if (unit === "usd") return `US$${value}`;
  if (unit === "idr") return `Rp${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
  return `${(Number(value) * 100).toFixed(1)}%`;
}
