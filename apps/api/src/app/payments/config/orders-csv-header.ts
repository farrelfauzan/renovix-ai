/** The columns of the daily payments CSV (RNX-35, AC19): one row per order, then one per unmatched payment. */
export const ORDERS_CSV_HEADER = ["orderId", "providerRef", "amountRupiah", "createdAt", "expiresAt", "paidAt", "lastWebhookAt", "status", "flags"] as const;
