import type { Decimal } from "@prisma/client/runtime/client";

/** An offer as read for the price list (RNX-53): its name and its current version, if one is in effect. */
export type PricedOffer = {
  readonly name: string;
  readonly versions: readonly { readonly creditsGranted: Decimal; readonly priceUsdCents: number }[];
};
