/** The period a report covers (RNX-228): calendar days, both included, in the time zone named. */
export type ReportPeriod = {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
};
