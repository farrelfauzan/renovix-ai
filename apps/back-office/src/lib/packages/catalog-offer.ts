import type { OfferVersion } from "./offer-version";

/** A package, top-up pack or Enterprise bundle with all its versions, newest first. Flags a kind lacks are unset. */
export type CatalogOffer = {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly visible?: boolean;
  readonly displayOrder?: number;
  readonly versions: readonly OfferVersion[];
};
