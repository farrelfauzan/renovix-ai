/** One offer on the public price list (RNX-53): its name, the credits it grants and its rupiah price. */
export type PriceListItem = {
  readonly name: string;
  readonly credits: number;
  readonly priceRupiah: number;
};
