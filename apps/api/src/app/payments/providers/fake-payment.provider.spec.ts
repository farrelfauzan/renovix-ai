import { createHmac } from "node:crypto";
import { FakePaymentProvider } from "./fake-payment.provider";

// RNX-35: the fake provider, no network. Test-only key; made-up values.
const KEY = "rx35-unit-test-fake-key";
const sign = (raw: string, key = KEY) => createHmac("sha256", key).update(raw).digest("hex");
const request = (raw: string, signature?: string) => ({ rawBody: Buffer.from(raw), headers: signature === undefined ? {} : { "x-fake-signature": signature } });

describe("FakePaymentProvider (RNX-35)", () => {
  it("deterministic references; pending until simulatePaid; unknown for a reference it never created", async () => {
    const fake = new FakePaymentProvider({ webhookSecret: KEY });
    const expiresAt = new Date("2026-10-22T01:15:00Z");

    const charge = await fake.createCharge({ orderId: "order-1", amountRupiah: 165_000, expiresAt, description: "test" });

    expect(charge).toEqual({ providerRef: "fake_order-1", paymentCode: "fake-qris:fake_order-1", expiresAt });
    expect(await fake.getStatus("fake_order-1")).toEqual({ state: "pending", amountRupiah: null, paidAt: null });
    const paidAt = new Date("2026-10-22T01:05:00Z");
    fake.simulatePaid("order-1", { paidAt });
    expect(await fake.getStatus("fake_order-1")).toEqual({ state: "paid", amountRupiah: 165_000, paidAt });
    expect(await fake.getStatus("fake_other")).toEqual({ state: "unknown", amountRupiah: null, paidAt: null });
  });

  it("verifies a webhook only with the HMAC-SHA256 of the exact raw bytes under its key", async () => {
    const fake = new FakePaymentProvider({ webhookSecret: KEY });
    const raw = JSON.stringify({ reference: "fake_order-1", status: "paid", amountRupiah: 165_000 });

    expect(await fake.verifyWebhook(request(raw, sign(raw)))).toEqual({ isVerified: true, providerRef: "fake_order-1", reportedState: "paid", reportedAmountRupiah: 165_000 });
    expect(await fake.verifyWebhook(request(raw, sign(raw, "other-key")))).toEqual({ isVerified: false });
    expect(await fake.verifyWebhook(request(`${raw} `, sign(raw)))).toEqual({ isVerified: false });
    expect(await fake.verifyWebhook(request(raw))).toEqual({ isVerified: false });
  });

  it("without a key nothing verifies, not even a signature made with an empty key", async () => {
    const fake = new FakePaymentProvider();
    const raw = JSON.stringify({ reference: "fake_order-1", status: "paid", amountRupiah: 1 });

    expect(await fake.verifyWebhook(request(raw, sign(raw, "")))).toEqual({ isVerified: false });
  });
});
