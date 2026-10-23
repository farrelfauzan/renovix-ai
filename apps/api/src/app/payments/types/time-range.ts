/** A half-open time range: from `start` (included) to `end` (excluded). */
export type TimeRange = {
  readonly start: Date;
  readonly end: Date;
};
