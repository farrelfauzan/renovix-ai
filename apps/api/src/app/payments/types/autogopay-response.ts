/** An AutoGoPay answer as received (RNX-229): the HTTP status and the JSON body (undefined when it is not JSON). */
export type AutoGoPayResponse = {
  readonly status: number;
  readonly body: unknown;
};
