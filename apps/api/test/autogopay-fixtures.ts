/**
 * RNX-229: recorded fixtures of AutoGoPay's QRIS API, written from the documented shapes (R-20 section 3.1), not
 * from live traffic: no AutoGoPay account exists (D240) and no test calls the service. Every value is obviously fake.
 * Shapes the docs leave open (status and cancel answers, the error body, the expiry and paid_at formats) are assumed;
 * confirm against the live API (RNX-229 DoD pilot).
 */
export const autoGoPayFixtures = {
  /** The API key in tests; never a real key. Also the webhook signing key. */
  apiKey: "test-autogopay-key-not-real",
  generate: {
    success: {
      status: 200,
      body: {
        transaction_id: "agp-test-txn-0001",
        order_id: "agp-test-order-0001",
        amount: 165_000,
        transaction_status: "pending",
        qr_string: "00020101021226-test-qris-not-real-6304ABCD",
        qr_url: "https://autogopay.site/qr/test-not-real.png",
        checkout_url: "https://autogopay.site/pay/test-token-not-real",
        transaction_time: "2026-10-23T10:00:00+07:00",
        expiry_time: "2026-10-23T10:15:00+07:00",
      },
    },
    /** Assumed error shape (not documented for /qris/generate). */
    error: { status: 400, body: { success: false, message: "amount out of range" } },
    /** A 200 whose expiry carries no offset: refused rather than read in the server's zone. */
    expiryWithoutOffset: {
      status: 200,
      body: { transaction_id: "agp-test-txn-0002", qr_string: "00020101-test-qris-not-real", expiry_time: "2026-10-23 10:15:00" },
    },
  },
  status: {
    settlement: { status: 200, body: { transaction_id: "agp-test-txn-0001", transaction_status: "settlement", amount: 165_000, paid_at: "2026-10-23T10:05:00+07:00" } },
    pending: { status: 200, body: { transaction_id: "agp-test-txn-0001", transaction_status: "pending", amount: 165_000 } },
    expire: { status: 200, body: { transaction_id: "agp-test-txn-0001", transaction_status: "expire", amount: 165_000 } },
    cancel: { status: 200, body: { transaction_id: "agp-test-txn-0001", transaction_status: "cancel", amount: 165_000 } },
    unknownStatus: { status: 200, body: { transaction_id: "agp-test-txn-0001", transaction_status: "refund", amount: 165_000 } },
    malformed: { status: 200, body: { transaction_id: "agp-test-txn-0001" } },
    serverError: { status: 500, body: undefined },
  },
  cancel: {
    success: { status: 200, body: { transaction_id: "agp-test-txn-0001", transaction_status: "cancel" } },
    error: { status: 404, body: { success: false, message: "transaction not found" } },
  },
  webhook: {
    /** The exact bytes as sent: two-space indentation, the documented key order. Signed in each test with `apiKey`. */
    rawBody: `{
  "event": "transaction.received",
  "timestamp": "2026-10-23T10:05:01+07:00",
  "transaction": {
    "transaction_id": "agp-test-txn-0001",
    "order_id": "agp-test-order-0001",
    "amount": 165000,
    "status": "PAID",
    "payment_method": "QRIS",
    "paid_at": "2026-10-23T10:05:00+07:00"
  }
}`,
    /** The same content with another key order and no whitespace: a different byte string. */
    reorderedBody:
      '{"transaction":{"status":"PAID","amount":165000,"transaction_id":"agp-test-txn-0001","order_id":"agp-test-order-0001","payment_method":"QRIS","paid_at":"2026-10-23T10:05:00+07:00"},"timestamp":"2026-10-23T10:05:01+07:00","event":"transaction.received"}',
    headers: { "content-type": "application/json", "x-callback-event": "transaction.received", "user-agent": "AutoGopay-Callback/1.0" },
  },
} as const;
