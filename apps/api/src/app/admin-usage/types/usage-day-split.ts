/** The days of a period split by where their sums come from (RNX-228): the rollups, or the raw rows (live). */
export type UsageDaySplit = {
  readonly builtDays: string[];
  readonly liveDays: string[];
};
