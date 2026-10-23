import { createHmac } from "node:crypto";
import { inspect } from "node:util";
import { autoGoPayFixtures as fx } from "../../../../test/autogopay-fixtures";
import { captureOutput } from "../../../../test/capture-output";
import type { AutoGoPayRequestOptions } from "../types/autogopay-request-options";
import type { AutoGoPayResponse } from "../types/autogopay-response";
import type { AutoGoPayTransport } from "../types/autogopay-transport";
import { AutoGoPayProvider } from "./autogopay.provider";
import { FetchAutoGoPayTransport } from "./fetch-autogopay.transport";

// RNX-229: the AutoGoPay adapter over a fake transport answering recorded fixtures. No network, no real key (D240).
type Call = { readonly path: string; readonly body: Readonly<Record<string, unknown>>; readonly options: AutoGoPayRequestOptions };

/** A transport that records each call and answers the given responses in order (an Error is thrown). */
function fakeTransport(...answers: (AutoGoPayResponse | Error)[]): { calls: Call[]; transport: AutoGoPayTransport } {
  const calls: Call[] = [];
  const transport: AutoGoPayTransport = {
    post: async (path, body, options) => {
      calls.push({ path, body, options });
      const answer = answers.shift();
      if (answer === undefined) throw new Error("fake transport: no answer left");
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { calls, transport };
}

const providerWith = (...answers: (AutoGoPayResponse | Error)[]) => {
  const { calls, transport } = fakeTransport(...answers);
  return { calls, provider: new AutoGoPayProvider({ apiKey: fx.apiKey, transport }) };
};
// What AbortSignal.timeout makes fetch reject with (a DOMException named TimeoutError, an Error in Node's realm; Jest's
// sandbox has its own Error, so the test builds one here).
const timeout = (): Error => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const sign = (raw: string, key: string = fx.apiKey): string => createHmac("sha256", key).update(raw).digest("hex");
const webhook = (raw: string, signature?: string) => ({
  rawBody: Buffer.from(raw),
  headers: signature === undefined ? { ...fx.webhook.headers } : { ...fx.webhook.headers, "x-signature": signature },
});
const charge = { orderId: "order-1", amountRupiah: 165_000, expiresAt: new Date("2026-10-23T03:15:00Z"), description: "test" };

describe("AutoGoPayProvider (RNX-229)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("names itself autogopay with AutoGoPay's limits (Rp1 to Rp10.000.000)", () => {
    const { provider } = providerWith();

    expect([provider.name, provider.minAmountRupiah, provider.maxAmountRupiah]).toEqual(["autogopay", 1, 10_000_000]);
  });

  describe("createCharge", () => {
    it("POSTs /qris/generate with the exact amount and a 10 s timeout, and maps transaction_id, qr_string and expiry_time", async () => {
      const { calls, provider } = providerWith(fx.generate.success);

      const actual = await provider.createCharge(charge);

      expect(calls).toEqual([{ path: "/qris/generate", body: { amount: 165_000 }, options: { timeoutMs: 10_000 } }]);
      expect(actual).toEqual({ providerRef: "agp-test-txn-0001", paymentCode: fx.generate.success.body.qr_string, expiresAt: new Date("2026-10-23T03:15:00Z") });
    });

    it.each([
      ["an HTTP error", fx.generate.error, "AutoGoPay /qris/generate: unexpected answer (HTTP 400)"],
      ["a 200 whose body is not the documented shape", { status: 200, body: { success: true } }, "AutoGoPay /qris/generate: unexpected answer (HTTP 200)"],
      ["a 200 whose expiry has no offset", fx.generate.expiryWithoutOffset, "AutoGoPay /qris/generate: unexpected answer (HTTP 200)"],
      ["a timeout", timeout(), "AutoGoPay /qris/generate: the request failed (TimeoutError)"],
    ])("throws on %s, once (never retried)", async (_case, answer, message) => {
      const { calls, provider } = providerWith(answer as AutoGoPayResponse | Error);

      await expect(provider.createCharge(charge)).rejects.toThrow(message);
      expect(calls).toHaveLength(1);
    });
  });

  describe("getStatus", () => {
    it("POSTs /qris/status with the transaction id and a 10 s timeout by default", async () => {
      const { calls, provider } = providerWith(fx.status.pending);

      await provider.getStatus("agp-test-txn-0001");

      expect(calls).toEqual([{ path: "/qris/status", body: { transaction_id: "agp-test-txn-0001" }, options: { timeoutMs: 10_000 } }]);
    });

    it("uses a shorter total timeout when the caller gives one (the webhook path, D280)", async () => {
      const { calls, provider } = providerWith(fx.status.pending);

      await provider.getStatus("agp-test-txn-0001", { timeoutMs: 5_000 });

      expect(calls[0].options).toEqual({ timeoutMs: 5_000 });
    });

    it.each([
      ["settlement", fx.status.settlement, { state: "paid", amountRupiah: 165_000, paidAt: new Date("2026-10-23T03:05:00Z") }],
      ["pending", fx.status.pending, { state: "pending", amountRupiah: 165_000, paidAt: null }],
      ["expire", fx.status.expire, { state: "expired", amountRupiah: 165_000, paidAt: null }],
      ["cancel", fx.status.cancel, { state: "cancelled", amountRupiah: 165_000, paidAt: null }],
      ["an unmapped status", fx.status.unknownStatus, { state: "unknown", amountRupiah: 165_000, paidAt: null }],
      ["a prototype key as status", { status: 200, body: { transaction_status: "constructor" } }, { state: "unknown", amountRupiah: null, paidAt: null }],
      ["a malformed body", fx.status.malformed, { state: "unknown", amountRupiah: null, paidAt: null }],
      ["a body that is not JSON", { status: 200, body: undefined }, { state: "unknown", amountRupiah: null, paidAt: null }],
    ])("maps %s", async (_case, answer, expected) => {
      const { provider } = providerWith(answer as AutoGoPayResponse);

      expect(await provider.getStatus("agp-test-txn-0001")).toEqual(expected);
    });

    it.each([
      ["a timeout", timeout(), "AutoGoPay /qris/status: the request failed (TimeoutError)"],
      ["an HTTP error", fx.status.serverError, "AutoGoPay /qris/status: unexpected answer (HTTP 500)"],
    ])("throws on %s (the core counts it as an unknown answer)", async (_case, answer, message) => {
      const { provider } = providerWith(answer as AutoGoPayResponse | Error);

      await expect(provider.getStatus("agp-test-txn-0001")).rejects.toThrow(message);
    });
  });

  describe("cancel", () => {
    it("POSTs /qris/cancel with the transaction id; throws on an HTTP error", async () => {
      const { calls, provider } = providerWith(fx.cancel.success, fx.cancel.error);

      await provider.cancel("agp-test-txn-0001");
      await expect(provider.cancel("agp-test-txn-0001")).rejects.toThrow("AutoGoPay /qris/cancel: unexpected answer (HTTP 404)");

      expect(calls[0]).toEqual({ path: "/qris/cancel", body: { transaction_id: "agp-test-txn-0001" }, options: { timeoutMs: 10_000 } });
    });
  });

  describe("verifyWebhook", () => {
    const raw = fx.webhook.rawBody;

    it("verifies X-Signature (HMAC-SHA256 of the raw bytes, keyed with the API key) and reads the transaction", async () => {
      const { provider } = providerWith();

      expect(await provider.verifyWebhook(webhook(raw, sign(raw)))).toEqual({ isVerified: true, providerRef: "agp-test-txn-0001", reportedState: "paid", reportedAmountRupiah: 165_000 });
    });

    it.each([
      ["signed with another key", () => webhook(raw, sign(raw, "another-test-key-not-real"))],
      ["a tampered body", () => webhook(raw.replace("165000", "165001"), sign(raw))],
      ["no X-Signature", () => webhook(raw)],
      ["the body re-serialised (other whitespace), signed as re-serialised by the sender", () => webhook(raw, sign(JSON.stringify(JSON.parse(raw))))],
      ["the body with another key order, under the original body's signature", () => webhook(fx.webhook.reorderedBody, sign(raw))],
      ["an empty signature", () => webhook(raw, "")],
    ])("not verified: %s", async (_case, request) => {
      const { provider } = providerWith();

      expect(await provider.verifyWebhook(request())).toEqual({ isVerified: false });
    });

    it("not verified: a correctly signed body that is not the documented shape (as the fake provider does)", async () => {
      const { provider } = providerWith();
      const otherBody = JSON.stringify({ reference: "agp-test-txn-0001", status: "PAID" });

      expect(await provider.verifyWebhook(webhook(otherBody, sign(otherBody)))).toEqual({ isVerified: false });
      expect(await provider.verifyWebhook(webhook("not json", sign("not json")))).toEqual({ isVerified: false });
    });

    it("without a key nothing verifies, not even a signature made with an empty key", async () => {
      const provider = new AutoGoPayProvider({ apiKey: "", transport: fakeTransport().transport });

      expect(await provider.verifyWebhook(webhook(raw, sign(raw, "")))).toEqual({ isVerified: false });
    });
  });

  it("never puts the key, a signature or a body in a thrown error or in the output", async () => {
    const output = captureOutput();
    const raw = fx.webhook.rawBody;
    const signature = sign(raw);
    // The real fetch transport over a stubbed fetch whose own error message carries the key and the signature.
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`fetch failed: Bearer ${fx.apiKey} ${signature}`));
    const overFetch = new AutoGoPayProvider({ apiKey: fx.apiKey, transport: new FetchAutoGoPayTransport(fx.apiKey) });
    const { provider } = providerWith(fx.generate.error, timeout(), fx.status.serverError, fx.cancel.error);
    const failures = [
      overFetch.createCharge(charge),
      overFetch.getStatus("agp-test-txn-0001"),
      provider.createCharge(charge),
      provider.createCharge(charge),
      provider.getStatus("agp-test-txn-0001"),
      provider.cancel("agp-test-txn-0001"),
    ];

    const errors = await Promise.all(failures.map((failure) => failure.then(() => new Error("did not throw"), (err: unknown) => err)));
    await provider.verifyWebhook(webhook(raw, sign(raw, "another-test-key-not-real")));
    await provider.verifyWebhook(webhook(raw, signature));

    const text = [...errors.map((err) => `${String(err)}\n${inspect(err)}`), ...output.lines].join("\n");
    expect(errors.map((err) => (err as Error).message)).not.toContain("did not throw");
    expect(text).not.toContain(fx.apiKey);
    expect(text).not.toContain(signature);
    expect(text).not.toContain("Bearer");
    expect(text).not.toContain(fx.generate.error.body.message);
    expect(text).not.toContain('"transaction_id"');
  });
});
