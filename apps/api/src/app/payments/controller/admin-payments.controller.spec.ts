import { randomUUID } from "node:crypto";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import type { Prisma } from "@generated/prisma/client.js";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { AdminCreditsModule } from "../../admin-credits/admin-credits.module";
import { PrismaService } from "../../prisma/prisma.service";
import { FakePaymentProvider } from "../providers/fake-payment.provider";
import { PaymentReconciliationService } from "../service/payment-reconciliation.service";
import { toJakartaDay } from "../utils/to-jakarta-day";
import { createUser } from "../../../../test/factories";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, MINUTE, createAdmin } from "../../../../test/admin-auth";
import {
  STARTER_PRICE_RUPIAH,
  TEST_WEBHOOK_SECRET,
  createPaymentsApp,
  paidBalanceOf,
  seedPaymentCatalog,
  seedPaymentSettings,
  seedRate,
} from "../../../../test/payments";

// RNX-35a AC19 and AC20: the admin's manual reconciliation through real HTTP (Fastify inject), the real AccessGuard
// (staff sessions, permissions, re-authentication), the audit hook and the services on the test database, with
// FakePaymentProvider only. Built-in roles: finance holds credits:read and credits:adjust; viewer holds credits:read
// only; support holds neither. Made-up values only.

const ACCESS = "rx_admin_access";
const DAY_MS = 86_400_000;

describe("RNX-35a admin payments (Fastify, test database, fake provider)", () => {
  const fake = new FakePaymentProvider({ webhookSecret: TEST_WEBHOOK_SECRET });
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let catalog: Awaited<ReturnType<typeof seedPaymentCatalog>>;

  beforeAll(async () => {
    ({ moduleRef, prisma, app } = await createPaymentsApp(fake, [AdminCreditsModule]));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-35 test: no network"));
    catalog = await seedPaymentCatalog(prisma);
    await seedRate(prisma);
    await seedPaymentSettings(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  /** An admin of this role with a full session, re-authenticated `reauthAgo` ms ago (null: never); the id and the access cookie. */
  const signedIn = async (role: string, reauthAgo: number | null = 0) => {
    const admin = await createAdmin(prisma, moduleRef, { email: `${role}-${randomUUID().slice(0, 6)}@example.com`, role });
    const session = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    if (reauthAgo !== null) {
      await prisma.adminSession.update({ where: { id: session.sessionId }, data: { lastReauthAt: new Date(Date.now() - reauthAgo) } });
    }
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  const call = (method: "GET" | "POST", url: string, cookie: string, payload?: object) =>
    app.inject({ method, url, headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload });
  /** An order row as checkout would leave it, with overrides (status, flags, createdAt). */
  const insertOrder = async (userId: string, data: Partial<Prisma.PaymentOrderUncheckedCreateInput> = {}) => {
    const id = randomUUID();
    return prisma.paymentOrder.create({
      data: {
        id,
        userId,
        packageVersionId: catalog.starterVersionId,
        priceUsdCents: 1000,
        exchangeRate: "16500",
        exchangeRateDate: new Date(new Date().toISOString().slice(0, 10)),
        exchangeRateSource: "frankfurter",
        amountRupiah: STARTER_PRICE_RUPIAH,
        provider: "fake",
        providerRef: `fake_${id}`,
        paymentCode: `fake-qris:fake_${id}`,
        expiresAt: new Date(Date.now() + 15 * MINUTE),
        ...data,
      },
    });
  };
  /** A pending order that also exists at the fake provider (as a checkout leaves it). */
  const chargedOrder = async (userId: string) => {
    const order = await insertOrder(userId);
    await fake.createCharge({ orderId: order.id, amountRupiah: order.amountRupiah, expiresAt: order.expiresAt, description: "test" });
    return order;
  };
  const today = () => toJakartaDay(new Date());

  describe("AC19: the orders of a day, with counts, and the CSV", () => {
    const seedDay = async () => {
      const user = await createUser(prisma);
      await insertOrder(user.id);
      await insertOrder(user.id, { status: "paid", paidAt: new Date(), isLate: true, isWebhookMissed: true });
      await insertOrder(user.id, { status: "paid", paidAt: new Date(), isUnconfirmed: true });
      await insertOrder(user.id, { status: "expired" });
      await insertOrder(user.id, { status: "cancelled" });
      await insertOrder(user.id, { status: "failed", isAmountMismatch: true });
      await insertOrder(user.id, { status: "pending", unknownChecks: 3, needsReview: true });
      await insertOrder(user.id, { status: "paid", createdAt: new Date(Date.now() - 2 * DAY_MS) });
      await prisma.paymentUnmatchedPayment.create({ data: { provider: "fake", providerRef: "fake_unknown-1", reason: "unknown_reference", amountRupiah: 50_000 } });
      return user;
    };

    it("credits:read (viewer): every state and flag counted for the Jakarta day; another day's order is not listed", async () => {
      await seedDay();
      const { cookie } = await signedIn("viewer");

      const res = await call("GET", `/admin/payments/orders?day=${today()}`, cookie);

      expect(res.statusCode).toBe(200);
      expect(res.json().counts).toEqual({
        pending: 2,
        paid: 2,
        late: 1,
        expired: 1,
        cancelled: 1,
        failed: 1,
        unmatched: 1,
        amount_mismatch: 1,
        unconfirmed: 1,
        webhook_missed: 1,
        needs_review: 1,
      });
      expect(res.json().orders).toHaveLength(7);
      expect(res.json().unmatched).toEqual([expect.objectContaining({ providerRef: "fake_unknown-1", reason: "unknown_reference", status: "open" })]);
    });

    it.each([
      ["late", 1],
      ["webhook_missed", 1],
      ["amount_mismatch", 1],
      ["needs_review", 1],
      ["pending", 2],
      ["unmatched", 0],
    ])("state=%s lists only those orders (%i)", async (state, count) => {
      await seedDay();
      const { cookie } = await signedIn("viewer");

      const res = await call("GET", `/admin/payments/orders?day=${today()}&state=${state}`, cookie);

      expect(res.statusCode).toBe(200);
      expect(res.json().orders).toHaveLength(count);
    });

    it("an invalid day or state: 400", async () => {
      const { cookie } = await signedIn("viewer");

      expect((await call("GET", "/admin/payments/orders?day=2026-13-45", cookie)).statusCode).toBe(400);
      expect((await call("GET", `/admin/payments/orders?day=${today()}&state=bogus`, cookie)).statusCode).toBe(400);
    });

    it("the CSV: orderId, providerRef, amount, timestamps, status (and flags), one line per order then per unmatched payment; the export is audited", async () => {
      const user = await createUser(prisma);
      const order = await insertOrder(user.id, { status: "paid", paidAt: new Date(), isLate: true });
      await prisma.paymentUnmatchedPayment.create({ data: { provider: "fake", providerRef: "fake_unknown-2", reason: "unknown_reference", amountRupiah: 70_000 } });
      const { adminId, cookie } = await signedIn("finance");

      const res = await call("GET", `/admin/payments/orders/export?day=${today()}`, cookie);

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      const lines = res.body.split("\r\n");
      expect(lines[0]).toBe("orderId,providerRef,amountRupiah,createdAt,expiresAt,paidAt,lastWebhookAt,status,flags");
      expect(lines[1]).toBe(
        [order.id, order.providerRef, String(STARTER_PRICE_RUPIAH), order.createdAt.toISOString(), order.expiresAt.toISOString(), order.paidAt?.toISOString(), "", "paid", "late"].join(","),
      );
      expect(lines[2]).toMatch(/^,fake_unknown-2,70000,[^,]+,,,,unmatched,unknown_reference$/);
      expect(lines).toHaveLength(4);
      expect(await prisma.adminAuditLog.findMany({ where: { resource: "payment_orders", action: "export" } })).toEqual([
        expect.objectContaining({ adminId, after: { day: today(), orders: 1, unmatched: 1 } }),
      ]);
    });

    it("without credits:read (support): the list and the CSV are 403, and the export writes no audit row", async () => {
      const { cookie } = await signedIn("support");

      expect((await call("GET", `/admin/payments/orders?day=${today()}`, cookie)).statusCode).toBe(403);
      expect((await call("GET", `/admin/payments/orders/export?day=${today()}`, cookie)).statusCode).toBe(403);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });

  describe("AC20 (a): confirm from provider", () => {
    const confirm = (cookie: string, orderId: string) => call("POST", `/admin/payments/orders/${orderId}/confirm`, cookie, { reason: "Buyer sent a GoPay receipt (ticket TCK-35)" });

    it("credits:adjust, re-authenticated: the status check; on a settlement with the order's amount, one grant through the same path; audited (who, when, why)", async () => {
      const user = await createUser(prisma);
      const order = await chargedOrder(user.id);
      fake.simulatePaid(order.id);
      const { adminId, cookie } = await signedIn("finance");

      const res = await confirm(cookie, order.id);
      const again = await confirm(cookie, order.id);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ orderId: order.id, outcome: "granted", status: "paid" });
      expect(again.json()).toMatchObject({ outcome: "already_settled", status: "paid" });
      expect(await paidBalanceOf(prisma, user.id)).toBe("100");
      expect(await prisma.creditLedgerEntry.count()).toBe(1);
      expect(await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "paid", isWebhookMissed: true });
      expect(await prisma.paymentOrderChange.findFirstOrThrow({ where: { orderId: order.id, event: "paid" } })).toMatchObject({ source: "admin", actorId: adminId, note: "Buyer sent a GoPay receipt (ticket TCK-35)" });
      const audit = await prisma.adminAuditLog.findMany({ where: { resource: "payment_order", action: "confirm" }, orderBy: { createdAt: "asc" } });
      expect(audit).toHaveLength(2);
      expect(audit[0]).toMatchObject({ adminId, reason: "Buyer sent a GoPay receipt (ticket TCK-35)", before: { orderId: order.id, status: "pending" }, after: { orderId: order.id, status: "paid", outcome: "granted" } });
      expect(audit[0].effectiveAt).toBeInstanceOf(Date);
    });

    it("a settlement whose amount differs: no grant, amount_mismatch, audited", async () => {
      const user = await createUser(prisma);
      const order = await chargedOrder(user.id);
      fake.simulatePaid(order.id, { amountRupiah: STARTER_PRICE_RUPIAH + 1 });
      const { cookie } = await signedIn("finance");

      const res = await confirm(cookie, order.id);

      expect(res.json()).toEqual({ orderId: order.id, outcome: "amount_mismatch", status: "failed" });
      expect(await prisma.creditLedgerEntry.count()).toBe(0);
      expect(await prisma.adminAuditLog.count({ where: { action: "confirm" } })).toBe(1);
    });

    it.each([
      ["without credits:adjust (viewer), re-authenticated", "viewer", 0],
      ["credits:adjust (finance) but never re-authenticated", "finance", null],
      ["credits:adjust (finance) but re-authenticated 3 minutes ago (window: 2)", "finance", 3 * MINUTE],
    ])("%s: 403, no status check, nothing granted, no audit row", async (_case, role, reauthAgo) => {
      const user = await createUser(prisma);
      const order = await chargedOrder(user.id);
      fake.simulatePaid(order.id);
      const getStatus = jest.spyOn(fake, "getStatus");
      const { cookie } = await signedIn(role, reauthAgo);

      const res = await confirm(cookie, order.id);

      expect(res.statusCode).toBe(403);
      expect(getStatus).not.toHaveBeenCalled();
      expect(await prisma.creditLedgerEntry.count()).toBe(0);
      expect(await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "pending" });
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it("RNX-271 AC5: on an order the reconciliation job has claimed (claim kept after its check), the admin's check runs at once: a status check, the grant applied", async () => {
      const user = await createUser(prisma);
      const order = await chargedOrder(user.id);
      await prisma.paymentOrder.update({ where: { id: order.id }, data: { expiresAt: new Date(Date.now() - 5 * MINUTE) } });
      const job = await moduleRef.get(PaymentReconciliationService).reconcile();
      const claimed = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
      fake.simulatePaid(order.id);
      const getStatus = jest.spyOn(fake, "getStatus");
      const { cookie } = await signedIn("finance");

      const res = await confirm(cookie, order.id);

      expect(job).toMatchObject({ claimed: 1, outcomes: { unknown: 1 } });
      expect(claimed.reconcileClaimedUntil?.getTime()).toBeGreaterThan(Date.now());
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ orderId: order.id, outcome: "granted", status: "paid" });
      expect(getStatus).toHaveBeenCalledTimes(1);
      expect(await prisma.creditLedgerEntry.count()).toBe(1);
      expect(await paidBalanceOf(prisma, user.id)).toBe("100");
      expect(await prisma.paymentOrderChange.findFirstOrThrow({ where: { orderId: order.id, event: "paid" } })).toMatchObject({ source: "admin" });
    });

    it("an unknown order: 404, no audit row; with payments off: 503, nothing checked or granted", async () => {
      const user = await createUser(prisma);
      const order = await chargedOrder(user.id);
      fake.simulatePaid(order.id);
      const { cookie } = await signedIn("finance");

      const unknown = await confirm(cookie, randomUUID());
      await seedPaymentSettings(prisma, { paymentsEnabled: false });
      const paused = await confirm(cookie, order.id);

      expect(unknown.statusCode).toBe(404);
      expect(paused.statusCode).toBe(503);
      expect(await prisma.creditLedgerEntry.count()).toBe(0);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });

  describe("AC20 (b): mark unmatched as refunded", () => {
    const markRefunded = (cookie: string, id: string) => call("POST", `/admin/payments/unmatched/${id}/refunded`, cookie, { note: "Refunded in the GoPay Merchant app" });
    const unmatchedPayment = () => prisma.paymentUnmatchedPayment.create({ data: { provider: "fake", providerRef: `fake_unknown-${randomUUID().slice(0, 6)}`, reason: "unknown_reference", amountRupiah: 50_000 } });

    it("credits:adjust, re-authenticated: marked refunded with the note; audited (who, when, why); a second time is 409", async () => {
      const payment = await unmatchedPayment();
      const { adminId, cookie } = await signedIn("finance");

      const res = await markRefunded(cookie, payment.id);
      const again = await markRefunded(cookie, payment.id);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: payment.id, status: "refunded", refundedBy: adminId, refundNote: "Refunded in the GoPay Merchant app" });
      expect(again.statusCode).toBe(409);
      const audit = await prisma.adminAuditLog.findMany({ where: { resource: "payment_unmatched", action: "mark_refunded" } });
      expect(audit).toEqual([
        expect.objectContaining({ adminId, reason: "Refunded in the GoPay Merchant app", before: { unmatchedId: payment.id, status: "open" }, after: { unmatchedId: payment.id, status: "refunded", providerRef: payment.providerRef } }),
      ]);
    });

    it.each([
      ["without credits:adjust (viewer), re-authenticated", "viewer", 0],
      ["credits:adjust (finance) but never re-authenticated", "finance", null],
      ["credits:adjust (finance) but re-authenticated 3 minutes ago (window: 2)", "finance", 3 * MINUTE],
    ])("%s: 403, nothing changed, no audit row", async (_case, role, reauthAgo) => {
      const payment = await unmatchedPayment();
      const { cookie } = await signedIn(role, reauthAgo);

      const res = await markRefunded(cookie, payment.id);

      expect(res.statusCode).toBe(403);
      expect(await prisma.paymentUnmatchedPayment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "open", refundedAt: null });
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });

  describe("RNX-267 (D81): reads need credits:read; the two writes need credits:adjust and a fresh re-authentication", () => {
    const REAUTH_REQUIRED = "Re-authentication required";
    const writeBoth = async (cookie: string) => {
      const user = await createUser(prisma);
      const order = await chargedOrder(user.id);
      fake.simulatePaid(order.id);
      const payment = await prisma.paymentUnmatchedPayment.create({ data: { provider: "fake", providerRef: `fake_unknown-${randomUUID().slice(0, 6)}`, reason: "unknown_reference", amountRupiah: 50_000 } });
      const confirmed = await call("POST", `/admin/payments/orders/${order.id}/confirm`, cookie, { reason: "D81 check" });
      const refunded = await call("POST", `/admin/payments/unmatched/${payment.id}/refunded`, cookie, { note: "D81 check" });
      return { user, order, payment, confirmed, refunded };
    };

    it("(a) credits:read without credits:adjust (viewer, re-authenticated): 200 on the list and the CSV, 403 on confirm and on mark-refunded", async () => {
      const { cookie } = await signedIn("viewer");

      const list = await call("GET", `/admin/payments/orders?day=${today()}`, cookie);
      const csv = await call("GET", `/admin/payments/orders/export?day=${today()}`, cookie);
      const { user, order, payment, confirmed, refunded } = await writeBoth(cookie);

      expect([list.statusCode, csv.statusCode]).toEqual([200, 200]);
      expect([confirmed.statusCode, refunded.statusCode]).toEqual([403, 403]);
      expect([confirmed.json().message, refunded.json().message]).not.toContain(REAUTH_REQUIRED);
      expect(await paidBalanceOf(prisma, user.id)).toBe("0");
      expect(await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "pending" });
      expect(await prisma.paymentUnmatchedPayment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "open" });
    });

    it.each([
      ["never re-authenticated", null],
      ["re-authenticated 3 minutes ago (window: 2)", 3 * MINUTE],
    ])("(b) credits:adjust (finance) %s: confirm and mark-refunded are refused for the re-authentication; control: re-authenticated now, both go through", async (_case, reauthAgo) => {
      const stale = await signedIn("finance", reauthAgo);
      const fresh = await signedIn("finance");

      const refused = await writeBoth(stale.cookie);
      const allowed = await writeBoth(fresh.cookie);

      expect([refused.confirmed.statusCode, refused.refunded.statusCode]).toEqual([403, 403]);
      expect([refused.confirmed.json().message, refused.refunded.json().message]).toEqual([REAUTH_REQUIRED, REAUTH_REQUIRED]);
      expect(await paidBalanceOf(prisma, refused.user.id)).toBe("0");
      expect(await prisma.paymentUnmatchedPayment.findUniqueOrThrow({ where: { id: refused.payment.id } })).toMatchObject({ status: "open" });
      expect([allowed.confirmed.statusCode, allowed.refunded.statusCode]).toEqual([200, 200]);
      expect(allowed.confirmed.json()).toMatchObject({ outcome: "granted" });
      expect(allowed.refunded.json()).toMatchObject({ status: "refunded" });
    });
  });

  describe("AC20 (c): a payment seen in the GoPay Merchant app but unknown to the provider is fixed with RNX-227's adjustment", () => {
    it("POST /admin/credits/adjustments with the GoPay transaction id as the payment reference: one adjustment entry, audited with that reference", async () => {
      const user = await createUser(prisma);
      const { adminId, cookie } = await signedIn("finance");
      const gopayTransactionId = "GOPAY-TXN-0000-MADE-UP-35";

      const res = await call("POST", "/admin/credits/adjustments", cookie, {
        target: { userId: user.id },
        amount: "100",
        direction: "add",
        reason: "Paid in the GoPay Merchant app, unknown to the provider",
        paymentReference: gopayTransactionId,
        idempotencyKey: `gopay:${gopayTransactionId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(await paidBalanceOf(prisma, user.id)).toBe("100");
      const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { resource: "credit_account", action: "adjust" } });
      expect(audit).toMatchObject({ adminId, after: expect.objectContaining({ paymentReference: gopayTransactionId, amount: "100" }) });
    });
  });
});
