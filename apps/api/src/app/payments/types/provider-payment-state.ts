/**
 * A payment's state as a provider reports it, mapped by its adapter (RNX-35): `paid` (AutoGoPay "settlement"),
 * `pending`, `expired`, `cancelled`, or `unknown` for any answer the adapter cannot map (or none).
 */
export type ProviderPaymentState = "paid" | "pending" | "expired" | "cancelled" | "unknown";
