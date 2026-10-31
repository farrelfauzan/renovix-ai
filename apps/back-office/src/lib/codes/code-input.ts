/** What `POST /admin/codes` takes; the code text is generated when it is left out. */
export type CodeInput = {
  readonly code?: string;
  readonly type: "topup" | "subscription" | "both";
  readonly creditAmount?: number;
  /** RNX-251: the package version a "subscription" or "both" code grants (permanent, so no days). */
  readonly packageVersionId?: string;
  readonly maxRedemptions: number;
};
