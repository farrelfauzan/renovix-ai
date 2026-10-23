/**
 * The AutoGoPay QRIS API (RNX-229, R-20 section 3.1): the base URL, the three paths the adapter calls, and its
 * total timeout. The ticket's 5 s connect limit is not applied separately: Node's fetch exposes no connect timeout
 * without the undici package, so the 10 s total (AbortSignal) bounds the connect too (docs/payments.md).
 */
export const AUTOGOPAY_API = {
  baseUrl: "https://v1-gateway.autogopay.site",
  generatePath: "/qris/generate",
  statusPath: "/qris/status",
  cancelPath: "/qris/cancel",
  totalTimeoutMs: 10_000,
} as const;
