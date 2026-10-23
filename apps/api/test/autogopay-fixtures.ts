import type { AutoGoPayEnvelopedAnswer } from "./autogopay-enveloped-answer";

const DOCS_TRANSACTION_ID = "53bc6ed2-441d-4bd0-bc39-11fdfff5fedb";

/** An AutoGoPay answer: every one is wrapped as `{ success, message, data }` (the official docs). */
const toAnswer = <T>(status: number, isSuccess: boolean, message: string, data: T): AutoGoPayEnvelopedAnswer<T> => ({ status, body: { success: isSuccess, message, data } });

/**
 * RNX-229, RNX-273: recorded fixtures of AutoGoPay's QRIS API, taken from the official API docs' examples (D285), not
 * from live traffic: no AutoGoPay account exists (D240) and no test calls the service. The generate answer and the
 * webhook body are the docs' examples exactly. The docs show no status or cancel answer and no error answer: those are
 * built on the documented envelope with the documented status values (the status in `transaction_status` as in the
 * generate answer, one variant in `status` as in the sibling providers' status answers); confirm in the pilot.
 */
export const autoGoPayFixtures = {
  /** The API key in tests; never a real key. Also the webhook signing key. */
  apiKey: "test-autogopay-key-not-real",
  generate: {
    /** The docs' example answer, exactly (expiry_time 20:49 WIB = 13:49Z). */
    success: toAnswer(200, true, "QRIS created successfully", {
      transaction_id: DOCS_TRANSACTION_ID,
      order_id: "AUTOGOPAY-1774618440-2411",
      amount: 10000,
      transaction_status: "pending",
      qr_string: "00020101021226610014COM.GO-JEK.WWW...",
      qr_url: "https://v1-gateway.autogopay.site/qris/53bc6ed2-441d-4bd0-bc39-11fdfff5fedb/qr-code",
      checkout_url: "https://autogopay.site/pay/abc123def456",
      transaction_time: "2026-03-27 20:34:00",
      expiry_time: "2026-03-27 20:49:00",
    }),
    /** Assumed error answer (not documented for /qris/generate). */
    error: toAnswer(400, false, "amount out of range", null),
    /** HTTP 200 whose envelope says it failed. */
    refusedOn200: toAnswer(200, false, "QRIS generation failed", null),
    /** The documented fields at the top level, not in the envelope (the shape RNX-229 assumed). */
    notEnveloped: { status: 200, body: { transaction_id: "agp-test-txn-0002", qr_string: "00020101-test-qris-not-real", expiry_time: "2026-03-27T20:49:00+07:00" } },
    /** An expiry in neither documented form. */
    expiryUnreadable: toAnswer(200, true, "QRIS created successfully", { transaction_id: "agp-test-txn-0002", qr_string: "00020101-test-qris-not-real", expiry_time: "27/03/2026 20:49" }),
  },
  status: {
    settlement: toAnswer(200, true, "Status retrieved", { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "settlement", amount: 10000, paid_at: "2026-03-27 20:40:00" }),
    /** The status in `status` (as the sibling providers' status answers carry it) instead of `transaction_status`. */
    settlementAsStatus: toAnswer(200, true, "Status retrieved", { transaction_id: DOCS_TRANSACTION_ID, status: "settlement", amount: 10000, paid_at: "2026-03-27 20:40:00" }),
    pending: toAnswer(200, true, "Status retrieved", { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "pending", amount: 10000 }),
    expire: toAnswer(200, true, "Status retrieved", { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "expire", amount: 10000 }),
    cancel: toAnswer(200, true, "Status retrieved", { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "cancel", amount: 10000 }),
    unknownStatus: toAnswer(200, true, "Status retrieved", { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "refund", amount: 10000 }),
    /** HTTP 200 with `success: false` while pending (as the docs' QRIS Interactive status answers it). */
    pendingRefused: toAnswer(200, false, "Transaction pending", { transaction_id: DOCS_TRANSACTION_ID, status: "pending" }),
    /** HTTP 200 with `success: false` whose data still says settlement with the amount: unknown, never paid. */
    settlementRefused: toAnswer(200, false, "Transaction failed", { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "settlement", amount: 10000, paid_at: "2026-03-27 20:40:00" }),
    /** The settlement fields at the top level, not in the envelope (the shape RNX-229 assumed). */
    notEnveloped: { status: 200, body: { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "settlement", amount: 10000, paid_at: "2026-03-27T20:40:00+07:00" } },
    malformed: toAnswer(200, true, "Status retrieved", { transaction_id: DOCS_TRANSACTION_ID }),
    serverError: { status: 500, body: undefined },
  },
  cancel: {
    success: toAnswer(200, true, "QRIS cancelled", { transaction_id: DOCS_TRANSACTION_ID, transaction_status: "cancel" }),
    error: toAnswer(404, false, "transaction not found", null),
    refusedOn200: toAnswer(200, false, "transaction is not pending", null),
  },
  webhook: {
    /** The docs' example payload exactly (two-space indentation, the documented key order). Signed in each test with `apiKey`. */
    rawBody: `{
  "event": "transaction.received",
  "timestamp": "2024-03-29 14:30:45",
  "transaction": {
    "transaction_id": "TRX-001",
    "order_id": "ORDER-001",
    "amount": 50000,
    "status": "PAID",
    "payment_method": "QRIS",
    "paid_at": "2024-03-29 14:30:40"
  }
}`,
    /** The same content with another key order and no whitespace: a different byte string. */
    reorderedBody:
      '{"transaction":{"status":"PAID","amount":50000,"transaction_id":"TRX-001","order_id":"ORDER-001","payment_method":"QRIS","paid_at":"2024-03-29 14:30:40"},"timestamp":"2024-03-29 14:30:45","event":"transaction.received"}',
    headers: { "content-type": "application/json", "x-callback-event": "transaction.received", "user-agent": "AutoGopay-Callback/1.0" },
  },
} as const;
