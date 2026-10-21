/** A rate's own date (a calendar date at UTC midnight) and the moment to judge its age at (RNX-53). */
export type RateAgeInput = {
  readonly rateDate: Date;
  readonly now: Date;
};
