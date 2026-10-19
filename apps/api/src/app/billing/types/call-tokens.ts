/** The token counts of one model call (docs/credits.md Terms): new input, cached input and output. */
export type CallTokens = {
  readonly tokensNew: number;
  readonly tokensCached: number;
  readonly tokensOut: number;
};
