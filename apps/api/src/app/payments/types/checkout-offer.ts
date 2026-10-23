/** The offer version a checkout is for (RNX-35): exactly one of the two ids, its USD price, and a line for the provider. */
export type CheckoutOffer = {
  readonly packageVersionId: string | null;
  readonly topUpPackVersionId: string | null;
  readonly priceUsdCents: number;
  readonly description: string;
};
