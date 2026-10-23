/** What the core asks a provider to charge (RNX-35): the order it is for, the exact rupiah amount, and until when it may be paid. */
export type ChargeRequest = {
  readonly orderId: string;
  readonly amountRupiah: number;
  readonly expiresAt: Date;
  readonly description: string;
};
