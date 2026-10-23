import { Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { inspect } from "node:util";
import { autoGoPayFixtures as fx } from "../../../../test/autogopay-fixtures";
import { captureOutput } from "../../../../test/capture-output";
import type { AutoGoPayRequestOptions } from "../types/autogopay-request-options";
import type { AutoGoPayResponse } from "../types/autogopay-response";
import type { AutoGoPayTransport } from "../types/autogopay-transport";
import { AutoGoPayProvider } from "./autogopay.provider";
import { FetchAutoGoPayTransport } from "./fetch-autogopay.transport";

// RNX-229, RNX-273: the AutoGoPay adapter over a fake transport answering recorded fixtures taken from the official
// docs (every answer in the `{ success, message, data }` envelope). No network, no real key (D240).
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
const wrapInEnvelope = (data: unknown, isSuccess: boolean = true): AutoGoPayResponse => ({ status: 200, body: { success: isSuccess, message: "test", data } });
const toIgnoredLine = (method: string): string => `AutoGoPay webhook: payment_method ${JSON.stringify(method)} is not QRIS (ignored, not recorded)`;

describe("AutoGoPayProvider (RNX-229)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("names itself autogopay with AutoGoPay's limits (Rp1 to Rp10.000.000)", () => {
    const { provider } = providerWith();

    expect([provider.name, provider.minAmountRupiah, provider.maxAmountRupiah]).toEqual(["autogopay", 1, 10_000_000]);
  });

  describe("createCharge", () => {
    it("RNX-273: POSTs /qris/generate with the exact amount and a 10 s timeout, and maps the docs' example answer from data (expiry 20:49 WIB = 13:49Z)", async () => {
      const { calls, provider } = providerWith(fx.generate.success);

      const actual = await provider.createCharge(charge);

      expect(calls).toEqual([{ path: "/qris/generate", body: { amount: 165_000 }, options: { timeoutMs: 10_000 } }]);
      expect(actual).toEqual({ providerRef: "53bc6ed2-441d-4bd0-bc39-11fdfff5fedb", paymentCode: "00020101021226610014COM.GO-JEK.WWW...", expiresAt: new Date("2026-03-27T13:49:00Z") });
    });

    it.each([
      ["2026-10-23 19:15:00", new Date("2026-10-23T12:15:00Z")],
      ["2026-10-23T19:15:00+07:00", new Date("2026-10-23T12:15:00Z")],
      ["2026-10-23T12:15:00Z", new Date("2026-10-23T12:15:00Z")],
    ])("RNX-273: an expiry_time %s (no offset: WIB; an explicit offset still accepted) is %s", async (expiryTime, expected) => {
      const { provider } = providerWith(wrapInEnvelope({ ...fx.generate.success.body.data, expiry_time: expiryTime }));

      expect((await provider.createCharge(charge)).expiresAt).toEqual(expected);
    });

    it.each([
      ["an HTTP error", fx.generate.error, "AutoGoPay /qris/generate: unexpected answer (HTTP 400)"],
      ["RNX-273: a 200 with success: false", fx.generate.refusedOn200, "AutoGoPay /qris/generate: unexpected answer (HTTP 200)"],
      ["RNX-273: a 200 with success: false and the fields in data", wrapInEnvelope(fx.generate.success.body.data, false), "AutoGoPay /qris/generate: unexpected answer (HTTP 200)"],
      ["RNX-273: the fields at the top level, not in the envelope", fx.generate.notEnveloped, "AutoGoPay /qris/generate: unexpected answer (HTTP 200)"],
      ["a 200 without data", { status: 200, body: { success: true, message: "QRIS created successfully" } }, "AutoGoPay /qris/generate: unexpected answer (HTTP 200)"],
      ["RNX-273: an expiry in neither documented form", fx.generate.expiryUnreadable, "AutoGoPay /qris/generate: unexpected answer (HTTP 200)"],
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

    const unknown = { state: "unknown", amountRupiah: null, paidAt: null };

    it.each([
      ["settlement (paid_at 20:40 WIB = 13:40Z)", fx.status.settlement, { state: "paid", amountRupiah: 10_000, paidAt: new Date("2026-03-27T13:40:00Z") }],
      ["RNX-273: settlement in data.status instead of data.transaction_status", fx.status.settlementAsStatus, { state: "paid", amountRupiah: 10_000, paidAt: new Date("2026-03-27T13:40:00Z") }],
      ["RNX-273: transaction_status wins over status when both are present", wrapInEnvelope({ transaction_status: "pending", status: "settlement", amount: 10_000 }), { state: "pending", amountRupiah: 10_000, paidAt: null }],
      ["RNX-273: paid_at 2024-03-29 14:30:40 (WIB) as 07:30:40Z", wrapInEnvelope({ transaction_status: "settlement", amount: 50_000, paid_at: "2024-03-29 14:30:40" }), { state: "paid", amountRupiah: 50_000, paidAt: new Date("2024-03-29T07:30:40Z") }],
      ["paid_at with an explicit offset", wrapInEnvelope({ transaction_status: "settlement", amount: 50_000, paid_at: "2024-03-29T14:30:40+07:00" }), { state: "paid", amountRupiah: 50_000, paidAt: new Date("2024-03-29T07:30:40Z") }],
      ["an unreadable paid_at (null, the core takes now)", wrapInEnvelope({ transaction_status: "settlement", amount: 50_000, paid_at: "29/03/2024" }), { state: "paid", amountRupiah: 50_000, paidAt: null }],
      ["pending", fx.status.pending, { state: "pending", amountRupiah: 10_000, paidAt: null }],
      ["expire", fx.status.expire, { state: "expired", amountRupiah: 10_000, paidAt: null }],
      ["cancel", fx.status.cancel, { state: "cancelled", amountRupiah: 10_000, paidAt: null }],
      ["an unmapped status", fx.status.unknownStatus, { state: "unknown", amountRupiah: 10_000, paidAt: null }],
      ["RNX-273: success: false while pending", fx.status.pendingRefused, unknown],
      ["RNX-273: success: false whose data says settlement with the amount", fx.status.settlementRefused, unknown],
      ["RNX-273: the fields at the top level, not in the envelope", fx.status.notEnveloped, unknown],
      ["a prototype key as status", wrapInEnvelope({ transaction_status: "constructor" }), unknown],
      ["no status field", fx.status.malformed, unknown],
      ["a settlement without an amount (review round 1)", wrapInEnvelope({ transaction_status: "settlement", paid_at: "2026-10-23 10:05:00" }), unknown],
      ["a settlement with a null amount (review round 1)", wrapInEnvelope({ transaction_status: "settlement", amount: null }), unknown],
      ["a body that is not JSON", { status: 200, body: undefined }, unknown],
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
    it("POSTs /qris/cancel with the transaction id; throws on an HTTP error and (RNX-273) on a 200 with success: false", async () => {
      const { calls, provider } = providerWith(fx.cancel.success, fx.cancel.error, fx.cancel.refusedOn200);

      await provider.cancel("agp-test-txn-0001");
      await expect(provider.cancel("agp-test-txn-0001")).rejects.toThrow("AutoGoPay /qris/cancel: unexpected answer (HTTP 404)");
      await expect(provider.cancel("agp-test-txn-0001")).rejects.toThrow("AutoGoPay /qris/cancel: unexpected answer (HTTP 200)");

      expect(calls[0]).toEqual({ path: "/qris/cancel", body: { transaction_id: "agp-test-txn-0001" }, options: { timeoutMs: 10_000 } });
    });
  });

  describe("verifyWebhook", () => {
    const raw = fx.webhook.rawBody;

    it("verifies X-Signature (HMAC-SHA256 of the raw bytes, keyed with the API key) and reads the transaction of the docs' example", async () => {
      const { provider } = providerWith();

      expect(await provider.verifyWebhook(webhook(raw, sign(raw)))).toEqual({ isVerified: true, providerRef: "TRX-001", reportedState: "paid", reportedAmountRupiah: 50_000 });
    });

    it.each(["QRIS_SHOPEEPAY", "QRIS_INTERACTIVE", "qris"])("RNX-273: a signed webhook with payment_method %s is ignored, with one log line naming only the method", async (method) => {
      const { provider } = providerWith();
      const otherProduct = raw.replace('"payment_method": "QRIS"', `"payment_method": ${JSON.stringify(method)}`);
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(await provider.verifyWebhook(webhook(otherProduct, sign(otherProduct)))).toEqual({ isVerified: true, isIgnored: true });
      expect(warn.mock.calls).toEqual([[toIgnoredLine(method)]]);
    });

    it("RNX-273: a signed webhook without payment_method is taken as QRIS (the docs always send it)", async () => {
      const { provider } = providerWith();
      const noMethod = raw.replace('    "payment_method": "QRIS",\n', "");

      expect(noMethod).not.toContain("payment_method");
      expect(await provider.verifyWebhook(webhook(noMethod, sign(noMethod)))).toEqual({ isVerified: true, providerRef: "TRX-001", reportedState: "paid", reportedAmountRupiah: 50_000 });
    });

    it("#167 review: a signed webhook with payment_method null is taken as QRIS, not refused as unreadable", async () => {
      const { provider } = providerWith();
      const nullMethod = raw.replace('"payment_method": "QRIS"', '"payment_method": null');
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(nullMethod).toContain('"payment_method": null');
      expect(await provider.verifyWebhook(webhook(nullMethod, sign(nullMethod)))).toEqual({ isVerified: true, providerRef: "TRX-001", reportedState: "paid", reportedAmountRupiah: 50_000 });
      expect(warn).not.toHaveBeenCalled();
    });

    it("RNX-273: an ignored method is checked only after the signature (a forged one is not verified)", async () => {
      const { provider } = providerWith();
      const otherProduct = raw.replace('"payment_method": "QRIS"', '"payment_method": "QRIS_SHOPEEPAY"');

      expect(await provider.verifyWebhook(webhook(otherProduct, sign(otherProduct, "another-test-key-not-real")))).toEqual({ isVerified: false });
    });

    it.each([
      ["signed with another key", () => webhook(raw, sign(raw, "another-test-key-not-real"))],
      ["a tampered body", () => webhook(raw.replace("50000", "50001"), sign(raw))],
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

      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(await provider.verifyWebhook(webhook(otherBody, sign(otherBody)))).toEqual({ isVerified: false });
      expect(await provider.verifyWebhook(webhook("not json", sign("not json")))).toEqual({ isVerified: false });

      expect(warn.mock.calls).toEqual([
        ["AutoGoPay webhook: the signature is valid but the body is not the expected shape (not recorded)"],
        ["AutoGoPay webhook: the signature is valid but the body is not the expected shape (not recorded)"],
      ]);
      warn.mockRestore();
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
