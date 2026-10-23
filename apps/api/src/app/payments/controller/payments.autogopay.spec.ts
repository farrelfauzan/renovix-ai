import { createHash, createHmac, randomUUID } from "node:crypto";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { AutoGoPayProvider } from "../providers/autogopay.provider";
import { PaymentReconciliationService } from "../service/payment-reconciliation.service";
import { advance } from "../../../../test/admin-auth";
import { autoGoPayFixtures as fx } from "../../../../test/autogopay-fixtures";
import { captureLogLines } from "../../../../test/capture-log-lines";
import { createUser } from "../../../../test/factories";
import { ScriptedAutoGoPayTransport } from "../../../../test/scripted-autogopay-transport";
import { resetDatabase } from "../../../../test/test-database";
import {
  STARTER_PRICE_RUPIAH,
  TEST_PAYMENT_SETTINGS,
  createPaymentsApp,
  paidBalanceOf,
  paymentsHttp,
  seedPaymentCatalog,
  seedPaymentSettings,
  seedRate,
  sessionFromCookie,
  useFakeDateFromNow,
} from "../../../../test/payments";

// RNX-229: the acceptance criteria through the AutoGoPay adapter: real HTTP (Fastify inject, raw body kept as in
// main.ts), the real AccessGuard (better-auth's session lookup mocked: the cookie names the user), the real services and
// repositories on the test database, and AutoGoPayProvider over a scripted transport answering the recorded fixtures.
// No network (fetch is stubbed and the transport never calls it), a dummy key, made-up values only (D240).
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } } }));

const STARTER_CREDITS = "100";
const MINUTE = 60_000;
const GENERATE = "/qris/generate";
const STATUS = "/qris/status";

describe("RNX-229 AutoGoPay adapter (Fastify, test database, scripted transport)", () => {
  const transport = new ScriptedAutoGoPayTransport();
  const provider = new AutoGoPayProvider({ apiKey: fx.apiKey, transport });
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof paymentsHttp>;
  let catalog: Awaited<ReturnType<typeof seedPaymentCatalog>>;

  beforeAll(async () => {
    ({ moduleRef, prisma, app } = await createPaymentsApp(provider));
    http = paymentsHttp(app);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    transport.reset();
    mockGetSession.mockReset().mockImplementation(sessionFromCookie);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-229 test: no network"));
    catalog = await seedPaymentCatalog(prisma);
    await seedRate(prisma);
    await seedPaymentSettings(prisma);
    delete process.env.PAYMENTS_FORCE_OFF;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete process.env.PAYMENTS_FORCE_OFF;
  });

  afterAll(() => app?.close());

  const reconcile = () => moduleRef.get(PaymentReconciliationService).reconcile();
  /** The next interval's run: the fake clock moves one reconciliation interval on (the last run's claims have ended, RNX-271). */
  const reconcileNextInterval = () => {
    advance(TEST_PAYMENT_SETTINGS.paymentsReconcileEveryMinutes * MINUTE);
    return reconcile();
  };
  const buyStarter = (userId: string) => http.checkout(userId, { offer: "package", packageId: catalog.starterId });
  /** A user with a pending Starter order through the real checkout; its id and AutoGoPay transaction id. */
  const pendingStarterOrder = async () => {
    const user = await createUser(prisma);
    const res = await buyStarter(user.id);
    expect(res.statusCode).toBe(201);
    const order = await orderOf(res.json().orderId);
    return { user, orderId: order.id, reference: order.providerRef as string };
  };
  const orderOf = (id: string) => prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
  const grants = () => prisma.creditLedgerEntry.findMany({ orderBy: { createdAt: "asc" } });
  const expireOrder = (id: string) => prisma.paymentOrder.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 5 * MINUTE) } });
  /** The recorded webhook fixture's exact layout, for this transaction and amount. */
  const webhookBody = (reference: string, amount: number = STARTER_PRICE_RUPIAH): string =>
    fx.webhook.rawBody.replace('"agp-test-txn-0001"', JSON.stringify(reference)).replace("165000", String(amount));
  const sign = (raw: string, key: string = fx.apiKey): string => createHmac("sha256", key).update(raw).digest("hex");
  /** POST /webhooks/payments with the documented headers and these exact bytes; null: no X-Signature. */
  const webhook = (raw: string, signature: string | null = sign(raw)) =>
    app.inject({ method: "POST", url: "/webhooks/payments", headers: { ...fx.webhook.headers, ...(signature === null ? {} : { "x-signature": signature }) }, payload: raw });
  /** Nothing was charged: no generate call, no order, no credit. */
  const expectNoCharge = async () => {
    expect(transport.callsTo(GENERATE)).toHaveLength(0);
    expect(await prisma.paymentOrder.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  };

  describe("charge creation", () => {
    it("AC1: generate gets the snapshotted amount; transaction_id and expiry_time are stored; the QR string is returned (no checkout_url); pending, no credit", async () => {
      const user = await createUser(prisma);

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(201);
      const order = await prisma.paymentOrder.findFirstOrThrow();
      expect(transport.callsTo(GENERATE)).toEqual([{ path: GENERATE, body: { amount: STARTER_PRICE_RUPIAH }, options: { timeoutMs: 10_000 } }]);
      expect(order).toMatchObject({ amountRupiah: STARTER_PRICE_RUPIAH, provider: "autogopay", providerRef: expect.stringMatching(/^agp-test-txn-\d+$/), paymentCode: fx.generate.success.body.qr_string, status: "pending" });
      expect(order.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * MINUTE);
      expect(res.json()).toMatchObject({ orderId: order.id, state: "pending", amountRupiah: STARTER_PRICE_RUPIAH, paymentCode: fx.generate.success.body.qr_string, expiresAt: order.expiresAt.toISOString() });
      expect(JSON.stringify(res.json())).not.toContain("checkout_url");
      expect(JSON.stringify(res.json())).not.toContain(fx.generate.success.body.checkout_url);
      expect(await paidBalanceOf(prisma, user.id)).toBe("0");
    });

    it("AC2: above AutoGoPay's maximum (Rp10.000.000): 422 naming it, no generate call", async () => {
      const user = await createUser(prisma);
      const offer = await prisma.package.create({ data: { name: `Big-${randomUUID().slice(0, 6)}`, displayOrder: 9, active: true, visible: true } });
      await prisma.packageVersion.create({
        data: { packageId: offer.id, versionNumber: 1, priceUsdCents: 100_000, creditsGranted: 1, billing: "one_time", maxAgents: 1, maxConnectedTools: 1, apiAccess: false, allowedChannels: ["web"], allowedTiers: ["standard"], createdBy: "test", reason: "RNX-229 test" },
      });
      await seedPaymentSettings(prisma, { paymentsMaxPerPaymentRupiah: 50_000_000 });

      const res = await http.checkout(user.id, { offer: "package", packageId: offer.id });

      expect(provider.maxAmountRupiah).toBe(10_000_000);
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toContain("payment provider's maximum");
      await expectNoCharge();
    });

    it.each([
      ["AC2: above paymentsMaxPerPaymentRupiah", { paymentsMaxPerPaymentRupiah: STARTER_PRICE_RUPIAH - 1 }, "paymentsMaxPerPaymentRupiah"],
      ["AC18: the account's daily cap", { paymentsMaxPerAccountPerDayRupiah: STARTER_PRICE_RUPIAH - 1 }, "paymentsMaxPerAccountPerDayRupiah"],
      ["AC18: the platform's daily cap", { paymentsMaxPlatformPerDayRupiah: STARTER_PRICE_RUPIAH - 1 }, "paymentsMaxPlatformPerDayRupiah"],
    ])("%s: 422 naming it, no generate call", async (_case, settings, name) => {
      const user = await createUser(prisma);
      await seedPaymentSettings(prisma, settings);

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(422);
      expect(res.json().message).toContain(name);
      await expectNoCharge();
    });

    it.each([
      ["an error answer", fx.generate.error],
      ["a timeout", "timeout" as const],
    ])("AC3: generate gets %s: 502, the order failed, one call (no retry), no credit", async (_case, answer) => {
      const user = await createUser(prisma);
      transport.answerNextGenerate(answer);

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(502);
      expect(await prisma.paymentOrder.findFirstOrThrow()).toMatchObject({ status: "failed", providerRef: null });
      expect(transport.callsTo(GENERATE)).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe("0");
    });
  });

  describe("webhook", () => {
    it("AC4: a valid webhook answers 200 and is recorded with the SHA-256 of its raw body; its status check has the 5 s webhook timeout", async () => {
      const { orderId, reference } = await pendingStarterOrder();
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);
      const raw = webhookBody(reference);

      const res = await webhook(raw);

      expect(res.statusCode).toBe(200);
      expect(await prisma.paymentWebhookEvent.findMany()).toEqual([
        expect.objectContaining({ provider: "autogopay", providerRef: reference, orderId, reportedStatus: "paid", reportedAmountRupiah: STARTER_PRICE_RUPIAH, bodySha256: createHash("sha256").update(raw).digest("hex") }),
      ]);
      expect(transport.callsTo(STATUS).map((call) => call.options)).toEqual([{ timeoutMs: 5_000 }]);
      expect(await orderOf(orderId)).toMatchObject({ status: "paid" });
    });

    it("AC4: the status check hangs: the webhook still answers 200 within AutoGoPay's 10 s, the order stays pending counted unknown; the job (10 s timeout) later grants once", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      transport.answerStatus(reference, "slow");
      const startedAt = Date.now();

      const res = await webhook(webhookBody(reference));

      const elapsed = Date.now() - startedAt;
      expect(res.statusCode).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(4_900);
      expect(elapsed).toBeLessThan(10_000);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", unknownChecks: 1 });
      expect(await grants()).toHaveLength(0);
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);
      expect(await reconcile()).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });
      expect(transport.callsTo(STATUS).map((call) => call.options.timeoutMs)).toEqual([5_000, 10_000]);
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    }, 20_000);

    it.each([
      ["signed with another key", (raw: string) => webhook(raw, sign(raw, "another-test-key-not-real"))],
      ["a tampered body", (raw: string) => webhook(raw.replace(`${STARTER_PRICE_RUPIAH}`, `${STARTER_PRICE_RUPIAH + 1}`), sign(raw))],
      ["no X-Signature", (raw: string) => webhook(raw, null)],
      ["the body re-serialised, signed as re-serialised", (raw: string) => webhook(raw, sign(JSON.stringify(JSON.parse(raw))))],
    ])("AC5: %s: 401, nothing recorded, no status check, no credit", async (_case, send) => {
      const { orderId, reference } = await pendingStarterOrder();
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);

      const res = await send(webhookBody(reference));

      expect(res.statusCode).toBe(401);
      expect(await prisma.paymentWebhookEvent.count()).toBe(0);
      expect(transport.callsTo(STATUS)).toHaveLength(0);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending" });
      expect(await grants()).toHaveLength(0);
    });

    it("AC6: the webhook says PAID while the status says pending: no grant, unconfirmed; a later settlement completes it once", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();

      const res = await webhook(webhookBody(reference));

      expect(res.statusCode).toBe(200);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", isUnconfirmed: true });
      expect(await grants()).toHaveLength(0);
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);
      expect(await reconcile()).toMatchObject({ outcomes: { granted: 1 } });
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("review round 1 (probe P-1): a settlement status without an amount is unknown, not amount_mismatch: the order stays pending; a later settlement with the amount grants once", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      transport.setStatus(reference, "settlement");

      const res = await webhook(webhookBody(reference));

      expect(res.statusCode).toBe(200);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", isAmountMismatch: false, unknownChecks: 1 });
      expect(await grants()).toHaveLength(0);
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);
      await expireOrder(orderId);
      expect(await reconcile()).toMatchObject({ outcomes: { granted: 1 } });
      expect(await orderOf(orderId)).toMatchObject({ status: "paid" });
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("AC7, AC13: a settlement webhook for a transaction_id with no order (a second payment of the same QR): 200, unmatched, no grant", async () => {
      await pendingStarterOrder();
      const raw = webhookBody("agp-test-txn-no-order");

      const res = await webhook(raw);

      expect(res.statusCode).toBe(200);
      expect(await prisma.paymentUnmatchedPayment.findMany()).toEqual([
        expect.objectContaining({ provider: "autogopay", providerRef: "agp-test-txn-no-order", reason: "unknown_reference", orderId: null, amountRupiah: STARTER_PRICE_RUPIAH }),
      ]);
      expect(transport.callsTo(STATUS)).toHaveLength(0);
      expect(await grants()).toHaveLength(0);
    });
  });

  describe("exactly one grant", () => {
    it("AC8: the webhook twice, then the job: one ledger entry with the key payment:autogopay:<transaction_id>", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);

      const first = await webhook(webhookBody(reference));
      const second = await webhook(webhookBody(reference));
      await expireOrder(orderId);
      await reconcile();

      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      const entries = await grants();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: "plan_grant", reference, idempotencyKey: `payment:autogopay:${reference}` });
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("AC8: the job, then the webhook: one ledger entry", async () => {
      const { orderId, reference } = await pendingStarterOrder();
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);
      await expireOrder(orderId);

      await reconcile();
      const late = await webhook(webhookBody(reference));

      expect(late.statusCode).toBe(200);
      expect(await grants()).toHaveLength(1);
    });

    it("AC9: two orders of the same amount by one account within a minute: each grants once, by its own transaction_id", async () => {
      const user = await createUser(prisma);
      const [a, b] = [await buyStarter(user.id), await buyStarter(user.id)];
      const [first, second] = [await orderOf(a.json().orderId), await orderOf(b.json().orderId)];
      transport.setStatus(first.providerRef as string, "settlement", STARTER_PRICE_RUPIAH);

      await webhook(webhookBody(first.providerRef as string));

      expect(await orderOf(first.id)).toMatchObject({ status: "paid" });
      expect(await orderOf(second.id)).toMatchObject({ status: "pending", isUnconfirmed: false });
      transport.setStatus(second.providerRef as string, "settlement", STARTER_PRICE_RUPIAH);
      await webhook(webhookBody(second.providerRef as string));
      await webhook(webhookBody(first.providerRef as string));
      expect((await grants()).map((entry) => entry.reference).sort()).toEqual([first.providerRef, second.providerRef].sort());
      expect(await paidBalanceOf(prisma, user.id)).toBe("200");
    });
  });

  describe("missed, late, expired and wrong-amount payments", () => {
    it("AC10: no webhook; the job finds settlement: granted once, webhook_missed", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);

      expect(await reconcile()).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });

      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isWebhookMissed: true });
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("AC11: settlement after the order expired on our side: granted once, flagged late", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      transport.setStatus(reference, "expire", STARTER_PRICE_RUPIAH);
      await reconcile();
      expect(await orderOf(orderId)).toMatchObject({ status: "expired" });
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);

      await webhook(webhookBody(reference));
      await webhook(webhookBody(reference));

      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isLate: true });
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it.each([
      ["expire", "expired"],
      ["cancel", "cancelled"],
    ])("AC12: the status says %s past expiry: the order closes as %s, no credit, the buyer sees it", async (status, state) => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      transport.setStatus(reference, status, STARTER_PRICE_RUPIAH);

      await reconcile();

      expect(await orderOf(orderId)).toMatchObject({ status: state });
      expect((await http.getOrder(user.id, orderId)).json()).toMatchObject({ state });
      expect(await grants()).toHaveLength(0);
    });

    it.each([
      ["one rupiah short", STARTER_PRICE_RUPIAH - 1],
      ["one rupiah over", STARTER_PRICE_RUPIAH + 1],
    ])("AC14: settlement %s: no grant, amount_mismatch, listed unmatched with the paid amount", async (_case, amount) => {
      const { orderId, reference } = await pendingStarterOrder();
      transport.setStatus(reference, "settlement", amount);

      await webhook(webhookBody(reference, amount));

      expect(await orderOf(orderId)).toMatchObject({ status: "failed", isAmountMismatch: true, amountRupiah: STARTER_PRICE_RUPIAH });
      expect(await prisma.paymentUnmatchedPayment.findFirstOrThrow()).toMatchObject({ reason: "amount_mismatch", orderId, amountRupiah: amount });
      expect(await grants()).toHaveLength(0);
    });
  });

  describe("cancel and timeouts", () => {
    it("AC15: the provider said cancel, then a matching settlement arrives: granted once, flagged late", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      transport.setStatus(reference, "cancel", STARTER_PRICE_RUPIAH);
      await reconcile();
      expect(await orderOf(orderId)).toMatchObject({ status: "cancelled" });
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);

      await webhook(webhookBody(reference));
      await webhook(webhookBody(reference));

      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isLate: true });
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("AC16: a status timeout on the job path (10 s) is counted unknown and the order stays pending", async () => {
      const { orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      transport.answerStatus(reference, "timeout");

      expect(await reconcile()).toMatchObject({ outcomes: { unknown: 1 } });

      expect(transport.callsTo(STATUS).map((call) => call.options)).toEqual([{ timeoutMs: 10_000 }]);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", unknownChecks: 1 });
    });

    it("AC16: an unmapped status three times in a row: needs_review, the job stops claiming it, no credit", async () => {
      useFakeDateFromNow();
      const { orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      transport.setStatus(reference, "refund", STARTER_PRICE_RUPIAH);

      const runs = [await reconcile(), await reconcileNextInterval(), await reconcileNextInterval(), await reconcileNextInterval()];

      expect(runs.map((run) => run.outcomes)).toEqual([{ unknown: 1 }, { unknown: 1 }, { needs_review: 1 }, {}]);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", unknownChecks: 3, needsReview: true });
      expect(await grants()).toHaveLength(0);
    });
  });

  describe("AC17: the kill switch", () => {
    it.each([
      ["paymentsEnabled false", () => seedPaymentSettings(prisma, { paymentsEnabled: false }), () => seedPaymentSettings(prisma, { paymentsEnabled: true })],
      ["PAYMENTS_FORCE_OFF=true", async () => void (process.env.PAYMENTS_FORCE_OFF = "true"), async () => void delete process.env.PAYMENTS_FORCE_OFF],
    ])("%s: checkout 503 with no generate call; a webhook is recorded with no status call; switched on, the job completes it", async (_case, switchOff, switchOn) => {
      const { user, orderId, reference } = await pendingStarterOrder();
      transport.setStatus(reference, "settlement", STARTER_PRICE_RUPIAH);
      await switchOff();

      const checkout = await buyStarter(user.id);
      const res = await webhook(webhookBody(reference));

      expect(checkout.statusCode).toBe(503);
      expect(res.statusCode).toBe(200);
      expect(transport.callsTo(GENERATE)).toHaveLength(1);
      expect(transport.callsTo(STATUS)).toHaveLength(0);
      expect(await prisma.paymentWebhookEvent.count({ where: { orderId } })).toBe(1);
      expect(await grants()).toHaveLength(0);
      await switchOn();
      expect(await reconcile()).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });
  });

  it("AC22: a run with failing calls whose errors carry the key prints no key, signature or Authorization header; control: a planted line is found", async () => {
    const { lines } = captureLogLines();
    const { reference } = await pendingStarterOrder();
    const raw = webhookBody(reference);
    const signature = sign(raw);
    transport.answerNextGenerate(new TypeError(`fetch failed: Bearer ${fx.apiKey}`));
    await buyStarter((await createUser(prisma)).id);
    await webhook(raw, sign(raw, "another-test-key-not-real"));
    transport.answerStatus(reference, new Error(`status refused for Bearer ${fx.apiKey} ${signature}`));
    await webhook(raw);
    const isLeaked = (text: string) => text.includes(fx.apiKey) || text.includes(signature) || text.includes("Bearer");

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter(isLeaked)).toEqual([]);
    console.warn(`planted ${fx.apiKey}`);
    expect(lines.filter(isLeaked)).toHaveLength(1);
  });
});
