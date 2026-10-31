/** One invitation code as `GET /admin/codes` lists it (credit amounts are decimal strings). */
export type InvitationCode = {
  readonly id: string;
  readonly code: string;
  readonly type: "topup" | "subscription" | "both";
  readonly creditAmount: string | null;
  /** RNX-251: the package version a "subscription" or "both" code grants. */
  readonly packageVersion: { readonly id: string; readonly versionNumber: number; readonly package: { readonly name: string } } | null;
  readonly durationDays: number | null;
  readonly maxRedemptions: number;
  readonly timesRedeemed: number;
  readonly expiresAt: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly _count: { readonly redemptions: number };
};
