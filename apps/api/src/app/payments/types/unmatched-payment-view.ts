/** One unmatched payment on the admin list (RNX-35): what the provider reported, why it matched nothing, and its refund. */
export type UnmatchedPaymentView = {
  readonly id: string;
  readonly provider: string;
  readonly providerRef: string;
  readonly reason: string;
  readonly orderId: string | null;
  readonly amountRupiah: number | null;
  readonly status: string;
  readonly createdAt: string;
  readonly refundedAt: string | null;
  readonly refundedBy: string | null;
  readonly refundNote: string | null;
};
