import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PurchaseSnapshotService } from "../../offers/service/purchase-snapshot.service";
import { PrismaService } from "../../prisma/prisma.service";
import { FakePaymentProvider } from "../providers/fake-payment.provider";
import { PaymentReconciliationService } from "../service/payment-reconciliation.service";
import { PaymentSettlementService } from "../service/payment-settlement.service";
import { createUser } from "../../../../test/factories";
import { resetDatabase } from "../../../../test/test-database";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { captureLogLines } from "../../../../test/capture-log-lines";
import { advance } from "../../../../test/admin-auth";
import {
  STARTER_PRICE_RUPIAH,
  TEST_PAYMENT_SETTINGS,
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
  useFakeDateFromNow,
} from "../../../../test/payments";

// RNX-35a: the webhook, the one settlement (grant) path and the reconciliation job, through real HTTP (Fastify inject,
// raw body kept as in main.ts), the real services and repositories on the test database, and FakePaymentProvider only
// (real HMAC-SHA256 bytes under a test-only key). No network: fetch is stubbed. Made-up values only.
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } } }));

const STARTER_CREDITS = "100";
const MINUTE = 60_000;
const SECOND = 1_000;
/** The reconciliation interval of the test settings, and the slack its claim ends before it (RECONCILE_BATCH, RNX-271). */
const INTERVAL = TEST_PAYMENT_SETTINGS.paymentsReconcileEveryMinutes * MINUTE;
const CLAIM_SLACK = 30 * SECOND;

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
    jest.useRealTimers();
    delete process.env.PAYMENTS_FORCE_OFF;
  });

  afterAll(() => app?.close());

  const reconcile = () => moduleRef.get(PaymentReconciliationService).reconcile();
  /** The next interval's run: the fake clock moves one reconciliation interval on (the last run's claims have ended). */
  const reconcileNextInterval = () => {
    advance(INTERVAL);
    return reconcile();
  };
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

    it.each([
      ["one rupiah less", STARTER_PRICE_RUPIAH - 1],
      ["one rupiah more", STARTER_PRICE_RUPIAH + 1],
    ])("review round 1: %s after the provider said cancelled: no grant; failed with amount_mismatch (audited from cancelled), listed unmatched, the buyer sees unmatched", async (_case, paidAmount) => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      fake.simulateState(orderId, "cancelled");
      await reconcile();
      expect((await orderOf(orderId)).status).toBe("cancelled");
      fake.simulatePaid(orderId, { amountRupiah: paidAmount });

      const res = await paidWebhook(reference, paidAmount);

      expect(res.statusCode).toBe(200);
      expect(await orderOf(orderId)).toMatchObject({ status: "failed", isAmountMismatch: true, paidAt: null });
      expect(await grants()).toHaveLength(0);
      expect(await prisma.purchaseSnapshot.count()).toBe(0);
      expect(await prisma.paymentUnmatchedPayment.findFirstOrThrow()).toMatchObject({ providerRef: reference, reason: "amount_mismatch", orderId, amountRupiah: paidAmount, status: "open" });
      const change = await prisma.paymentOrderChange.findFirstOrThrow({ where: { orderId, event: "amount_mismatch" } });
      expect(change).toMatchObject({ fromStatus: "cancelled", toStatus: "failed", source: "webhook" });
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
      expect(await orderOf(orderId)).toMatchObject({ status: "expired" });
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

    it("review round 1 (BLOCKING 1): a paid answer after the provider said cancelled still grants once, flagged late, audited from cancelled", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await expireOrder(orderId);
      fake.simulateState(orderId, "cancelled");
      await reconcile();
      expect((await orderOf(orderId)).status).toBe("cancelled");
      fake.simulatePaid(orderId, { paidAt: new Date() });

      const first = await paidWebhook(reference);
      const again = await paidWebhook(reference);

      expect([first.statusCode, again.statusCode]).toEqual([200, 200]);
      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isLate: true });
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
      const paid = await prisma.paymentOrderChange.findFirstOrThrow({ where: { orderId, event: "paid" } });
      expect(paid).toMatchObject({ fromStatus: "cancelled", toStatus: "paid", source: "webhook" });
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
      useFakeDateFromNow();
      const { orderId } = await pendingStarterOrder();
      await expireOrder(orderId);
      fake.simulateState(orderId, "unknown");

      const runs = [await reconcile(), await reconcileNextInterval(), await reconcileNextInterval(), await reconcileNextInterval()];

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

    it("review round 1 (BLOCKING 2): one order whose check throws does not stop the batch; the next paid order is still granted, the failure is counted and logs only the error's class", async () => {
      const first = await pendingStarterOrder();
      const second = await pendingStarterOrder();
      await expireOrder(first.orderId, 20);
      await expireOrder(second.orderId, 10);
      fake.simulatePaid(first.orderId);
      fake.simulatePaid(second.orderId);
      const settlement = moduleRef.get(PaymentSettlementService);
      const checkOrder = settlement.checkOrder.bind(settlement);
      jest.spyOn(settlement, "checkOrder").mockImplementation(async (order, check) => {
        if (order.id === first.orderId) throw new RangeError(`check failed with ${TEST_WEBHOOK_SECRET}`);
        return checkOrder(order, check);
      });
      const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      const summary = await reconcile();

      expect(summary).toMatchObject({ claimed: 2, outcomes: { error: 1, granted: 1 } });
      expect(await orderOf(second.orderId)).toMatchObject({ status: "paid", isWebhookMissed: true });
      expect(await orderOf(first.orderId)).toMatchObject({ status: "pending", reconcileClaimedUntil: expect.any(Date) });
      expect(error).toHaveBeenCalledWith(`Payment order ${first.orderId}: the reconciliation check failed (RangeError)`);
      expect(JSON.stringify(error.mock.calls)).not.toContain(TEST_WEBHOOK_SECRET);
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

  describe("RNX-271: a reconciliation claim holds until the next interval's run (not released after the check)", () => {
    beforeEach(() => useFakeDateFromNow());

    /** The references the provider was asked about, sorted (one entry per status check). */
    const checkedReferences = (getStatus: jest.SpyInstance) => getStatus.mock.calls.map(([reference]) => reference as string).sort();
    /** Pending orders past their expiry whose status check answers pending (counted unknown): claimable each interval. */
    const expiredPendingOrders = async (count: number) => {
      const orders = [];
      for (let i = 0; i < count; i += 1) orders.push(await pendingStarterOrder());
      for (const { orderId } of orders) await expireOrder(orderId);
      return orders;
    };

    it("AC1: two runs at the same moment (two instances): each claimable order gets exactly one status check", async () => {
      const inputOrders = await expiredPendingOrders(3);
      const getStatus = jest.spyOn(fake, "getStatus");

      const [a, b] = await Promise.all([reconcile(), reconcile()]);

      expect(a.claimed + b.claimed).toBe(3);
      expect(checkedReferences(getStatus)).toEqual(inputOrders.map((order) => order.reference).sort());
    });

    it("AC1: a run one minute later in the same interval (another instance) claims and checks nothing; control: the next interval's run checks each order once more", async () => {
      const inputOrders = await expiredPendingOrders(3);
      const expectedReferences = inputOrders.map((order) => order.reference).sort();
      const getStatus = jest.spyOn(fake, "getStatus");

      const first = await reconcile();
      advance(MINUTE);
      const sameInterval = await reconcile();
      const actualAfterSameInterval = checkedReferences(getStatus);
      advance(INTERVAL - MINUTE);
      const nextInterval = await reconcile();

      expect([first.claimed, sameInterval.claimed, nextInterval.claimed]).toEqual([3, 0, 3]);
      expect(actualAfterSameInterval).toEqual(expectedReferences);
      expect(checkedReferences(getStatus)).toEqual([...expectedReferences, ...expectedReferences].sort());
    });

    it("the claim holds for the interval minus 30 s: a run 1 s before its end skips the order (no check); a run 1 s after it checks it", async () => {
      await expiredPendingOrders(1);
      const getStatus = jest.spyOn(fake, "getStatus");
      await reconcile();

      advance(INTERVAL - CLAIM_SLACK - SECOND);
      const justBefore = await reconcile();
      advance(2 * SECOND);
      const justAfter = await reconcile();

      expect([justBefore.claimed, justAfter.claimed]).toEqual([0, 1]);
      expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["every 5 minutes: 5 minutes minus 30 s", async () => seedPaymentSettings(prisma, { paymentsReconcileEveryMinutes: 5 }), 5 * MINUTE - CLAIM_SLACK],
      ["every minute (the shortest): 30 s, still after now", async () => seedPaymentSettings(prisma, { paymentsReconcileEveryMinutes: 1 }), MINUTE - CLAIM_SLACK],
      ["not set (the job does not run; reconcile() called directly): the 5-minute fallback", async () => void (await prisma.platformSetting.delete({ where: { name: "paymentsReconcileEveryMinutes" } })), 5 * MINUTE],
    ])("the claim kept after the check, interval %s", async (_case, setEveryMinutes, expectedClaimMs) => {
      const [{ orderId }] = await expiredPendingOrders(1);
      await setEveryMinutes();
      const now = Date.now();

      const summary = await reconcile();

      expect(summary.claimed).toBe(1);
      expect((await orderOf(orderId)).reconcileClaimedUntil?.getTime()).toBe(now + expectedClaimMs);
    });

    it("AC2: an unknown answer, two runs at once and one more a minute later in each interval: unknown_checks rises by exactly 1 per interval; needs_review only at the 3rd interval", async () => {
      const [{ orderId }] = await expiredPendingOrders(1);
      fake.simulateState(orderId, "unknown");
      /** One interval: two runs racing, a third a minute later; the order after them; then the clock moves to the next interval. */
      const runInterval = async () => {
        await Promise.all([reconcile(), reconcile()]);
        advance(MINUTE);
        await reconcile();
        const { unknownChecks, needsReview } = await orderOf(orderId);
        advance(INTERVAL - MINUTE);
        return { unknownChecks, needsReview };
      };

      const actual = [await runInterval(), await runInterval(), await runInterval()];

      expect(actual).toEqual([
        { unknownChecks: 1, needsReview: false },
        { unknownChecks: 2, needsReview: false },
        { unknownChecks: 3, needsReview: true },
      ]);
      expect(await prisma.paymentOrderChange.count({ where: { orderId, event: "unknown_status" } })).toBe(2);
      expect(await prisma.paymentOrderChange.count({ where: { orderId, event: "needs_review" } })).toBe(1);
      expect(await grants()).toHaveLength(0);
    });

    it("AC3: a webhook names a claimed order: the job does not check it again in this interval; at the next interval it is checked and, paid, grants once through the normal path", async () => {
      const { user, orderId, reference } = await pendingStarterOrder();
      await paidWebhook(reference);
      const first = await reconcile();
      advance(MINUTE);
      await paidWebhook(reference);
      const getStatus = jest.spyOn(fake, "getStatus");

      const sameInterval = await reconcile();
      const actualChecksInInterval = getStatus.mock.calls.length;
      fake.simulatePaid(orderId);
      advance(INTERVAL - MINUTE);
      const nextInterval = await reconcile();

      expect(first).toMatchObject({ claimed: 1, outcomes: { pending: 1 } });
      expect(sameInterval).toMatchObject({ claimed: 0, outcomes: {} });
      expect(actualChecksInInterval).toBe(0);
      expect(nextInterval).toMatchObject({ claimed: 1, outcomes: { granted: 1 } });
      expect(getStatus).toHaveBeenCalledTimes(1);
      expect(await orderOf(orderId)).toMatchObject({ status: "paid", isWebhookMissed: false });
      expect(await prisma.paymentOrderChange.findFirstOrThrow({ where: { orderId, event: "paid" } })).toMatchObject({ source: "reconcile" });
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("AC4 (regression): a paid answer, two runs at once and one more in the same interval: one status check, exactly one ledger entry", async () => {
      const [{ user, orderId }] = await expiredPendingOrders(1);
      fake.simulatePaid(orderId);
      const getStatus = jest.spyOn(fake, "getStatus");

      const racing = await Promise.all([reconcile(), reconcile()]);
      advance(MINUTE);
      const later = await reconcile();

      expect([...racing, later].map((run) => run.outcomes.granted ?? 0).reduce((sum, granted) => sum + granted, 0)).toBe(1);
      expect(getStatus).toHaveBeenCalledTimes(1);
      expect(await grants()).toHaveLength(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe(STARTER_CREDITS);
    });

    it("review round 1: a batch slower than its claim (each check 10 s, a provider timing out): the run stops before its claim ends and the next interval's run, overlapping it, checks no order twice within one claim window", async () => {
      const inputOrders = await expiredPendingOrders(8);
      await seedPaymentSettings(prisma, { paymentsReconcileEveryMinutes: 1 });
      for (const { orderId } of inputOrders) fake.simulateState(orderId, "unknown");
      const start = Date.now();
      const checks: { reference: string; at: number }[] = [];
      const realGetStatus = fake.getStatus.bind(fake);
      let nextRun: Promise<unknown> | null = null;
      // Each status check takes 10 s; the next interval's run (another tick, same or other instance) starts one minute
      // after the first while the first is still checking (the scheduler does not stop overlapping runs).
      jest.spyOn(fake, "getStatus").mockImplementation(async (reference: string) => {
        if (nextRun === null && Date.now() - start >= MINUTE) {
          nextRun = reconcile();
          await nextRun;
        }
        checks.push({ reference, at: Date.now() });
        advance(10 * SECOND);
        return realGetStatus(reference);
      });

      await reconcile();
      if (nextRun === null) {
        advance(start + MINUTE - Date.now());
        await reconcile();
      }

      const timesOf = (reference: string) => checks.filter((check) => check.reference === reference).map((check) => check.at).sort((a, b) => a - b);
      const actualGaps = inputOrders.flatMap(({ reference }) => timesOf(reference).slice(1).map((at, i) => ({ reference, gapMs: at - timesOf(reference)[i] })));
      expect(actualGaps.filter(({ gapMs }) => gapMs < MINUTE - CLAIM_SLACK)).toEqual([]);
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
