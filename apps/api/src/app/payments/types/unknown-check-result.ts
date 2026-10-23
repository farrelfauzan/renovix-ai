/** An order after one more unknown status answer (RNX-35): the count, and whether it now needs manual review. */
export type UnknownCheckResult = {
  readonly unknownChecks: number;
  readonly needsReview: boolean;
};
