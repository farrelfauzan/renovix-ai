import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PurchaseSnapshotService } from "../../offers/service/purchase-snapshot.service";
import { PrismaService } from "../../prisma/prisma.service";
import { FakePaymentProvider } from "../providers/fake-payment.provider";
import { PaymentReconciliationService } from "../service/payment-reconciliation.service";
import { createUser } from "../../../../test/factories";
import { resetDatabase } from "../../../../test/test-database";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { captureLogLines } from "../../../../test/capture-log-lines";
import {
  STARTER_PRICE_RUPIAH,
  TEST_WEBHOOK_SECRET,
  createPaymentsApp,
  fakeSignature,
  fakeWebhookBody,
  paidBalanceOf,
  paymentsHttp,
  seedPaymentCatalog,
  seedPaymentSettings,
  seedRate,
  sessionFromCookie,
} from "../../../../test/payments";

// RNX-35a: the webhook, the one settlement (grant) path and the reconciliation job, through real HTTP (Fastify inject,
// raw body kept as in main.ts), the real services and repositories on the test database, and FakePaymentProvider only
// (real HMAC-SHA256 bytes under a test-only key). No network: fetch is stubbed. Made-up values only.
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } } }));

const STARTER_CREDITS = "100";
const MINUTE = 60_000;

describe("RNX-35a webhook, grant and reconciliation (Fastify, test database, fake provider)", () => {
  const fake = new FakePaymentProvider({ webhookSecret: TEST_WEBHOOK_SECRET });
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof paymentsHttp>;
  let catalog: Awaited<ReturnType<typeof seedPaymentCatalog>>;

  beforeAll(async () => {
    ({ moduleRef, prisma, app } = await createPaymentsApp(fake));
    http = paymentsHttp(app);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mockGetSession.mockReset().mockImplementation(sessionFromCookie);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-35 test: no network"));
    catalog = await seedPaymentCatalog(prisma);
    await seedRate(prisma);
    await seedPaymentSettings(prisma);
    delete process.env.PAYMENTS_FORCE_OFF;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PAYMENTS_FORCE_OFF;
  });

  afterAll(() => app?.close());

  const reconcile = () => moduleRef.get(PaymentReconciliationService).reconcile();
  /** A user with a pending Starter order (through the real checkout); its id and reference. */
  const pendingStarterOrder = async () => {
    const user = await createUser(prisma);
    const res = await http.checkout(user.id, { offer: "package", packageId: catalog.starterId });
    expect(res.statusCode).toBe(201);
    const orderId: string = res.json().orderId;
    return { user, orderId, reference: `fake_${orderId}` };
  };
  const paidWebhook = (reference: string, amount = STARTER_PRICE_RUPIAH) => http.webhook(fakeWebhookBody(reference, "paid", amount));
  const orderOf = (id: string) => prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
  const grants = () => prisma.creditLedgerEntry.findMany({ orderBy: { createdAt: "asc" } });
  /** Moves the order's expiry into the past (as if its time ran out). */
  const expireOrder = (id: string, minutesAgo = 5) => prisma.paymentOrder.update({ where: { id }, data: { expiresAt: new Date(Date.now() - minutesAgo * MINUTE) } });

  describe("AC1: a paid order creates exactly one ledger grant", () => {
    it("a verified webhook + a paid status with the order's amount: one plan_grant of the snapshot's credits, key payment:fake:<ref>; snapshot with the provider reference", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);

      const res = await paidWebhook(reference);

      expect(res.statusCode).toBe(200);
      const order = await orderOf(orderId);
      expect(order).toMatchObject({ status: "paid", isLate: false, isWebhookMissed: false });
      const [snapshot] = await prisma.purchaseSnapshot.findMany();
      expect(snapshot).toMatchObject({ buyerUserId: user.id, packageVersionId: catalog.starterVersionId, paymentId: reference, priceRupiah: STARTER_PRICE_RUPIAH, priceUsdCents: 1000 });
      const entries = await grants();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: "plan_grant", wallet: "paid", memberUserId: user.id, reference, idempotencyKey: `payment:fake:${reference}` });
      expect(entries[0].reference).toBe(snapshot.paymentId);
      expect(entries[0].amount.toString()).toBe(STARTER_CREDITS);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
      expect((await http.getOrder(user.id, orderId)).json()).toMatchObject({ state: "paid", paymentCode: null });
      expect(await assertCreditLedgerInvariants(prisma)).toBe(1);
    });

    it("one snapshot per payment is enforced: a second snapshot with the same payment id fails (purchase_snapshots_payment_id_key)", async () => {
      const { orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      await paidWebhook(reference);
      const { id: _id, createdAt: _createdAt, ...copy } = await prisma.purchaseSnapshot.findFirstOrThrow({ where: { paymentId: reference } });

      const second = prisma.purchaseSnapshot.create({ data: copy });

      await expect(second).rejects.toMatchObject({ code: "P2002" });
      expect(await prisma.purchaseSnapshot.count({ where: { paymentId: reference } })).toBe(1);
    });

    it("the webhook twice: one grant, one snapshot", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);

      const first = await paidWebhook(reference);
      const second = await paidWebhook(reference);

      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      expect(await grants()).toHaveLength(1);
      expect(await prisma.purchaseSnapshot.count()).toBe(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
      expect(await prisma.paymentWebhookEvent.count({ where: { orderId } })).toBe(2);
    });

    it("a webhook and the reconciliation job both see it: one grant", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      await expireOrder(orderId);

      const summary = await reconcile();
      const late = await paidWebhook(reference);
      const again = await reconcile();

      expect(summary).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });
      expect(late.statusCode).toBe(200);
      expect(again.claimed).toBe(0);
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("race: two webhooks and the job check the same paid order at the same moment: exactly one grant, one snapshot", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      await prisma.paymentOrder.update({ where: { id: orderId }, data: { lastWebhookAt: new Date() } });
      const getStatus = fake.getStatus.bind(fake);
      let arrived = 0;
      let releaseAll!: () => void;
      const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
      jest.spyOn(fake, "getStatus").mockImplementation(async (ref: string) => {
        arrived += 1;
        if (arrived === 3) releaseAll();
        await allArrived;
        return getStatus(ref);
      });

      const results = await Promise.all([paidWebhook(reference), paidWebhook(reference), reconcile()]);

      expect(arrived).toBe(3);
      expect(results.slice(0, 2).map((r) => (r as { statusCode: number }).statusCode)).toEqual([200, 200]);
      expect(await grants()).toHaveLength(1);
      expect(await prisma.purchaseSnapshot.count()).toBe(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
      expect(await prisma.paymentOrderChange.count({ where: { orderId, event: "paid" } })).toBe(1);
    });

    it.each([
      ["the ledger append (third write)", () => jest.spyOn(CreditLedgerService.prototype, "appendEntry")],
      ["the snapshot write (second write)", () => jest.spyOn(PurchaseSnapshotService.prototype, "recordPaidPurchase")],
    ])("transaction boundary: %s fails: the order stays pending (the paid update rolled back), no snapshot, no credits; a later webhook grants once", async (_case, spyOnWrite) => {
      const { user, orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      spyOnWrite().mockRejectedValueOnce(new Error("planted write failure"));
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      const failed = await paidWebhook(reference);

      expect(failed.statusCode).toBe(500);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", paidAt: null });
      expect(await prisma.purchaseSnapshot.count()).toBe(0);
      expect(await grants()).toHaveLength(0);
      expect(await prisma.paymentOrderChange.count({ where: { orderId, event: "paid" } })).toBe(0);
      const retried = await paidWebhook(reference);
      expect(retried.statusCode).toBe(200);
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });
  });

  describe("AC2: a webhook with a bad signature is rejected and grants nothing", () => {
    it.each([
      ["signed with another key", (raw: string) => fakeSignature(raw, "another-made-up-key")],
      ["no signature header", () => null],
      ["a signature that is not hex", () => "not-a-signature"],
    ])("%s: 401, nothing recorded, nothing granted, the order still pending", async (_case, sign) => {
      const { orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      const raw = fakeWebhookBody(reference, "paid", STARTER_PRICE_RUPIAH);

      const res = await http.webhook(raw, sign(raw));

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Invalid webhook signature");
      expect(await prisma.paymentWebhookEvent.count()).toBe(0);
      expect(await grants()).toHaveLength(0);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", lastWebhookAt: null });
    });

    it("the body changed by one byte after signing: 401, nothing granted", async () => {
      const { orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      const raw = fakeWebhookBody(reference, "paid", STARTER_PRICE_RUPIAH);

      const res = await http.webhook(raw.replace(`${STARTER_PRICE_RUPIAH}`, `${STARTER_PRICE_RUPIAH + 1}`), fakeSignature(raw));

      expect(res.statusCode).toBe(401);
      expect(await grants()).toHaveLength(0);
    });

    it("control: the same body with the right signature is accepted, recorded with the SHA-256 of the raw body, and grants", async () => {
      const { orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      const raw = fakeWebhookBody(reference, "paid", STARTER_PRICE_RUPIAH);

      const res = await http.webhook(raw);

      expect(res.statusCode).toBe(200);
      const { createHash } = await import("node:crypto");
      expect(await prisma.paymentWebhookEvent.findFirstOrThrow()).toMatchObject({ orderId, providerRef: reference, reportedStatus: "paid", reportedAmountRupiah: STARTER_PRICE_RUPIAH, bodySha256: createHash("sha256").update(raw).digest("hex") });
      expect(await grants()).toHaveLength(1);
    });
  });

  describe("AC3: a webhook alone never grants", () => {
    it("a valid webhook says paid while the status check says pending: nothing granted, the order is unconfirmed; a later status check returning paid completes it", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();

      const res = await paidWebhook(reference);

      expect(res.statusCode).toBe(200);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", isUnconfirmed: true });
      expect(await grants()).toHaveLength(0);
      fake.simulatePaid(orderId);
      const summary = await reconcile();
      expect(summary).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });
      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isUnconfirmed: true });
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
      expect((await prisma.paymentOrderChange.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } })).map((c) => [c.event, c.source])).toEqual([
        ["created", "checkout"],
        ["unconfirmed", "webhook"],
        ["paid", "reconcile"],
      ]);
    });
  });

  describe("AC4: a paid status whose amount differs from the order by one rupiah", () => {
    it.each([
      ["one rupiah less", STARTER_PRICE_RUPIAH - 1],
      ["one rupiah more", STARTER_PRICE_RUPIAH + 1],
    ])("%s: no grant; the order fails with amount_mismatch, the payment is listed unmatched, the buyer sees unmatched", async (_case, paidAmount) => {
      const { user, orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId, { amountRupiah: paidAmount });

      const res = await paidWebhook(reference, paidAmount);

      expect(res.statusCode).toBe(200);
      expect(await orderOf(orderId)).toMatchObject({ status: "failed", isAmountMismatch: true, paidAt: null });
      expect(await grants()).toHaveLength(0);
      expect(await prisma.purchaseSnapshot.count()).toBe(0);
      expect(await prisma.paymentUnmatchedPayment.findFirstOrThrow()).toMatchObject({ providerRef: reference, reason: "amount_mismatch", orderId, amountRupiah: paidAmount, status: "open" });
      expect((await http.getOrder(user.id, orderId)).json()).toMatchObject({ state: "unmatched" });
    });
  });

  describe("AC5: expiry and late payment", () => {
    it("an expired order creates no credits: the job finds it past expiry, the provider says expired, it closes as expired", async () => {
      const { user, orderId } = await pendingStarterOrder();
      await expireOrder(orderId);
      fake.simulateState(orderId, "expired");

      const summary = await reconcile();

      expect(summary).toMatchObject({ claimed: 1, outcomes: { expired: 1 } });
      expect(await orderOf(orderId)).toMatchObject({ status: "expired", reconcileClaimedUntil: null });
      expect(await grants()).toHaveLength(0);
      expect((await http.getOrder(user.id, orderId)).json()).toMatchObject({ state: "expired", paymentCode: null });
    });

    it("a late payment (paid after the order expired and closed) still grants once, flagged late", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId, 10);
      fake.simulateState(orderId, "expired");
      await reconcile();
      fake.simulatePaid(orderId, { paidAt: new Date() });

      const first = await paidWebhook(reference);
      const again = await paidWebhook(reference);

      expect([first.statusCode, again.statusCode]).toEqual([200, 200]);
      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isLate: true });
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
      const paid = await prisma.paymentOrderChange.findFirstOrThrow({ where: { orderId, event: "paid" } });
      expect(paid).toMatchObject({ fromStatus: "expired", toStatus: "paid", source: "webhook" });
    });

    it("the job finds a pending order past its expiry already paid (no webhook came): grants once through the same path, flagged late and webhook_missed", async () => {
      const { user, orderId } = await pendingStarterOrder();
      await expireOrder(orderId);
      fake.simulatePaid(orderId, { paidAt: new Date() });

      const summary = await reconcile();

      expect(summary).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });
      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isLate: true, isWebhookMissed: true });
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
      expect(await reconcile()).toMatchObject({ claimed: 0 });
      expect(await grants()).toHaveLength(1);
    });
  });

  describe("AC6: a webhook for an unknown reference", () => {
    it("is stored as unmatched and grants nothing; sent twice, it is listed once", async () => {
      const raw = fakeWebhookBody("fake_00000000-0000-4000-8000-00000000dead", "paid", 50_000);

      const first = await http.webhook(raw);
      const second = await http.webhook(raw);

      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      expect(await prisma.paymentWebhookEvent.count({ where: { orderId: null } })).toBe(2);
      expect(await prisma.paymentUnmatchedPayment.findMany()).toEqual([
        expect.objectContaining({ providerRef: "fake_00000000-0000-4000-8000-00000000dead", reason: "unknown_reference", orderId: null, amountRupiah: 50_000, status: "open" }),
      ]);
      expect(await grants()).toHaveLength(0);
      expect(await prisma.purchaseSnapshot.count()).toBe(0);
    });
  });

  describe("AC7: with payments off, a valid webhook is recorded and grants nothing; turning payments on lets the job complete it", () => {
    it.each([
      ["paymentsEnabled false", async () => seedPaymentSettings(prisma, { paymentsEnabled: false }), async () => seedPaymentSettings(prisma, { paymentsEnabled: true })],
      ["PAYMENTS_FORCE_OFF=true", async () => void (process.env.PAYMENTS_FORCE_OFF = "true"), async () => void delete process.env.PAYMENTS_FORCE_OFF],
    ])("%s", async (_case, switchOff, switchOn) => {
      const { user, orderId, reference } = await pendingStarterOrder();
      fake.simulatePaid(orderId);
      await switchOff();
      const getStatus = jest.spyOn(fake, "getStatus");

      const res = await paidWebhook(reference);
      const whileOff = await reconcile();

      expect(res.statusCode).toBe(200);
      expect(await prisma.paymentWebhookEvent.count({ where: { orderId } })).toBe(1);
      expect(getStatus).not.toHaveBeenCalled();
      expect(whileOff).toEqual({ isPaused: true, claimed: 0, outcomes: {} });
      expect(await orderOf(orderId)).toMatchObject({ status: "pending" });
      expect(await grants()).toHaveLength(0);
      await switchOn();
      const summary = await reconcile();
      expect(summary).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });
  });

  describe("reconciliation: unknown answers", () => {
    it("an unknown answer keeps the order pending and is counted; after 3 the order is listed for manual review and the job stops claiming it", async () => {
      const { orderId } = await pendingStarterOrder();
      await expireOrder(orderId);
      fake.simulateState(orderId, "unknown");

      const runs = [await reconcile(), await reconcile(), await reconcile(), await reconcile()];

      expect(runs.map((r) => r.outcomes)).toEqual([{ unknown: 1 }, { unknown: 1 }, { needs_review: 1 }, {}]);
      expect(await orderOf(orderId)).toMatchObject({ status: "pending", unknownChecks: 3, needsReview: true });
      expect(await grants()).toHaveLength(0);
    });

    it("a status check that throws counts as unknown and logs only the error's class", async () => {
      const { orderId } = await pendingStarterOrder();
      await expireOrder(orderId);
      jest.spyOn(fake, "getStatus").mockRejectedValueOnce(new TypeError("provider exploded"));
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      expect(await reconcile()).toMatchObject({ outcomes: { unknown: 1 } });
      expect(warn).toHaveBeenCalledWith(`Payment order ${orderId}: the status check failed (TypeError)`);
    });

    it("two job runs at the same moment (two instances) claim disjoint rows: each order is checked once", async () => {
      const orders = [await pendingStarterOrder(), await pendingStarterOrder(), await pendingStarterOrder()];
      for (const { orderId } of orders) {
        await expireOrder(orderId);
        fake.simulatePaid(orderId);
      }
      const getStatus = jest.spyOn(fake, "getStatus");

      const [a, b] = await Promise.all([reconcile(), reconcile()]);

      expect(a.claimed + b.claimed).toBe(3);
      expect(getStatus).toHaveBeenCalledTimes(3);
      expect(await grants()).toHaveLength(3);
    });
  });

  describe("AC11: the logs of a payments run hold no provider key, signature secret or account detail", () => {
    const ACCOUNT_DETAIL = "GoPay 0812-0000-3535 a.n. Made Up Merchant";

    it("a full run (checkout, refused charge, bad and good webhooks, a throwing status check with the secret in its message) logs none of them; control: a planted line is found", async () => {
      const { lines } = captureLogLines();
      const { orderId, reference } = await pendingStarterOrder();
      fake.failNextCharge();
      await http.checkout((await createUser(prisma)).id, { offer: "package", packageId: catalog.starterId });
      const raw = fakeWebhookBody(reference, "paid", STARTER_PRICE_RUPIAH);
      await http.webhook(raw, fakeSignature(raw, "wrong-made-up-key"));
      jest.spyOn(fake, "getStatus").mockRejectedValueOnce(new Error(`key ${TEST_WEBHOOK_SECRET} rejected for ${ACCOUNT_DETAIL}`));
      await http.webhook(raw);
      fake.simulatePaid(orderId);
      await http.webhook(raw);
      const signature = fakeSignature(raw);
      const isLeaked = (text: string) => text.includes(TEST_WEBHOOK_SECRET) || text.includes(ACCOUNT_DETAIL) || text.includes(signature);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.filter(isLeaked)).toEqual([]);
      expect(await grants()).toHaveLength(1);
      new Logger("RNX-35 control").warn(`planted ${ACCOUNT_DETAIL}`);
      expect(lines.filter(isLeaked)).toHaveLength(1);
    });
  });
});
