/** What `POST /admin/codes` takes; the code text is generated when it is left out. */
export type CodeInput = {
  readonly code?: string;
  readonly type: "topup" | "subscription" | "both";
  readonly creditAmount?: number;
  readonly planId?: string;
  readonly durationDays?: number;
  readonly maxRedemptions: number;
};
