/** The outcome of one rate refresh (RNX-53): the stored rate's own date, or why nothing was stored. */
export type RateRefreshResult =
  | { readonly isStored: true; readonly rateDate: string }
  | { readonly isStored: false; readonly reason: string };
