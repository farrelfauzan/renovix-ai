import type { UsageSumRow } from "./usage-sum-row";

/** What one usage report row is built from (RNX-228): the summed row and the users' emails by id. */
export type UsageReportRowInput = {
  readonly row: UsageSumRow;
  readonly emails: ReadonlyMap<string, string>;
};
