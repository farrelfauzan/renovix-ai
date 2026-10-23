/** The ledger idempotency key of a payment's grant (RNX-35): one grant per provider reference, whoever completes it. */
export const paymentIdempotencyKey = (provider: string, providerRef: string): string => `payment:${provider}:${providerRef}`;
