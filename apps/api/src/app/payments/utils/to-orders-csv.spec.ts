import { toOrdersCsv } from "./to-orders-csv";

// RNX-35 AC19: the CSV columns (orderId, providerRef, amount, timestamps, status). Made-up values only.
const ORDER = {
  orderId: "order-1",
  userId: "user-1",
  offer: "top_up_pack" as const,
  provider: "fake",
  providerRef: "fake_order-1",
  amountRupiah: 165_000,
  status: "paid",
  flags: ["late", "webhook_missed"],
  unknownChecks: 0,
  createdAt: "2026-10-22T01:00:00.000Z",
  expiresAt: "2026-10-22T01:15:00.000Z",
  paidAt: "2026-10-22T01:20:00.000Z",
  lastWebhookAt: null,
};
const UNMATCHED = {
  id: "u-1",
  provider: "fake",
  providerRef: "=fake_unknown",
  reason: "unknown_reference",
  orderId: null,
  amountRupiah: 50_000,
  status: "refunded",
  createdAt: "2026-10-22T02:00:00.000Z",
  refundedAt: "2026-10-22T03:00:00.000Z",
  refundedBy: "admin-1",
  refundNote: "refunded in the merchant app",
};

describe("toOrdersCsv (RNX-35, AC19)", () => {
  it("the header, one line per order, then one per unmatched payment; CRLF; formula cells escaped", () => {
    expect(toOrdersCsv([ORDER], [UNMATCHED]).split("\r\n")).toEqual([
      "orderId,providerRef,amountRupiah,createdAt,expiresAt,paidAt,lastWebhookAt,status,flags",
      "order-1,fake_order-1,165000,2026-10-22T01:00:00.000Z,2026-10-22T01:15:00.000Z,2026-10-22T01:20:00.000Z,,paid,late webhook_missed",
      ",'=fake_unknown,50000,2026-10-22T02:00:00.000Z,,,,unmatched_refunded,unknown_reference",
      "",
    ]);
  });

  it("an empty day: the header only", () => {
    expect(toOrdersCsv([], [])).toBe("orderId,providerRef,amountRupiah,createdAt,expiresAt,paidAt,lastWebhookAt,status,flags\r\n");
  });
});
