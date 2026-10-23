/** One order on the admin list (RNX-35): ids, amount, status and flags, and its timestamps (ISO strings). */
export type AdminOrderView = {
  readonly orderId: string;
  readonly userId: string;
  readonly offer: "package" | "top_up_pack";
  readonly provider: string;
  readonly providerRef: string | null;
  readonly amountRupiah: number;
  readonly status: string;
  readonly flags: readonly string[];
  readonly unknownChecks: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly paidAt: string | null;
  readonly lastWebhookAt: string | null;
};
