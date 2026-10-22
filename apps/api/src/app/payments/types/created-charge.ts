/**
 * A charge the provider created (RNX-35): its own reference (its transaction id; the webhook and the status check name
 * the payment by it), what the buyer pays with (a QR string, e.g. a dynamic QRIS that carries the amount, or a URL),
 * and the provider's expiry.
 */
export type CreatedCharge = {
  readonly providerRef: string;
  readonly paymentCode: string;
  readonly expiresAt: Date;
};
