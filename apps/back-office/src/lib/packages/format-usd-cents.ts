/** US dollar cents as text, e.g. 4900 gives "$49.00". */
export function formatUsdCents(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "not set" : `$${(cents / 100).toFixed(2)}`;
}
