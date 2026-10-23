/** The days a report covers: YYYY-MM-DD, both included (Asia/Jakarta on the API side). */
export type ReportRange = {
  readonly from: string;
  readonly to: string;
};
