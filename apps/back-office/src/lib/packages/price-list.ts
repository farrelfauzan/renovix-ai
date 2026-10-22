/** The public `GET /api/v1/prices`: current rupiah prices by offer name and the USD to IDR rate they were derived at. */
export type PriceList = {
  readonly rate: string;
  readonly rateDate: string;
  readonly source: string;
  readonly topUpPacks: readonly { readonly name: string; readonly credits: number; readonly priceRupiah: number }[];
  readonly packages: readonly { readonly name: string; readonly credits: number; readonly priceRupiah: number }[];
};
