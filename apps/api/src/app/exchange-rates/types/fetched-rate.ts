/** The outcome of one call to the rate source (RNX-53): the rate and its own date (YYYY-MM-DD), or why there is none. */
export type FetchedRate =
  | { readonly isFetched: true; readonly rate: number; readonly rateDate: string }
  | { readonly isFetched: false; readonly reason: string };
