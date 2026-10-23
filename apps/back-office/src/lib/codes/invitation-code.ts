/** One invitation code as `GET /admin/codes` lists it (credit amounts are decimal strings). */
export type InvitationCode = {
  readonly id: string;
  readonly code: string;
  readonly type: "topup" | "subscription" | "both";
  readonly creditAmount: string | null;
  readonly plan: { readonly slug: string; readonly name: string } | null;
  readonly durationDays: number | null;
  readonly maxRedemptions: number;
  readonly timesRedeemed: number;
  readonly expiresAt: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly _count: { readonly redemptions: number };
};
