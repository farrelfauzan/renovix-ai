/** Rupiah with thousands dots, e.g. 149000 gives "Rp149.000". */
export function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}
