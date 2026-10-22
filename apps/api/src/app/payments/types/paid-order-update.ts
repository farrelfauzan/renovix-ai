/** How an order is marked paid (RNX-35): when the provider says it was paid, and whether the webhook was missed (no webhook seen, found by a check that was not a webhook's). */
export type PaidOrderUpdate = {
  readonly orderId: string;
  readonly paidAt: Date;
  readonly isWebhookMissedWhenNone: boolean;
};
