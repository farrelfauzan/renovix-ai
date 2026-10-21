import { randomUUID } from "node:crypto";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import type { CreditAccountOwner } from "../../billing/types/credit-account-owner";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminCreditsModule } from "../admin-credits.module";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin, MINUTE } from "../../../../test/admin-auth";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-227: a back-office credit adjustment through real HTTP (Fastify `inject`), the real AccessGuard, audit hook,
// CreditLedgerService and PrismaService on the test database. Obviously fake values only.

const ACCESS = "rx_admin_access";
const REASON = "Goodwill credit after the 2026-10-20 outage";

type Json = Record<string, any>;

describe("Credit adjustments (RNX-227, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule, AdminCreditsModule] }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

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
  const adjust = (cookie: string, payload: Json) =>
    app.inject({ method: "POST", url: "/admin/credits/adjustments", headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload });
  const bodyFor = (target: Json, overrides: Json = {}): Json => ({
    target,
    amount: "10.5",
    direction: "add",
    reason: REASON,
    ticketReference: "TCK-0001",
    idempotencyKey: randomUUID(),
    ...overrides,
  });
  /** A company id with a contract (there is no company table). */
  const createCompany = async (): Promise<string> => {
    const companyId = randomUUID();
    const bundle = await prisma.enterpriseBundle.create({ data: { name: `bundle-${companyId}`, active: true } });
    const version = await prisma.enterpriseBundleVersion.create({ data: { bundleId: bundle.id, versionNumber: 1, createdBy: "test", reason: "test" } });
    await prisma.companyContract.create({
      data: { companyId, bundleVersionId: version.id, seatLimit: 5, allowedTiers: ["standard"], whatsappEnabled: false },
    });
    return companyId;
  };
  const paidBalance = async (owner: CreditAccountOwner): Promise<string | null> =>
    (await prisma.creditAccount.findFirst({ where: { ...owner, wallet: "paid" } }))?.balance.toString() ?? null;
  const adjustmentEntries = () => prisma.creditLedgerEntry.findMany({ where: { type: "adjustment" }, orderBy: { seq: "asc" } });
  const auditRows = () => prisma.adminAuditLog.findMany({ where: { resource: "credit_account", action: "adjust" }, orderBy: { createdAt: "asc" } });
  /** No adjustment entry, no audit row, and the paid balance still `balance`. */
  const expectNothingWritten = async (owner: CreditAccountOwner, balance: string | null) => {
    expect(await adjustmentEntries()).toEqual([]);
    expect(await auditRows()).toEqual([]);
    expect(await paidBalance(owner)).toBe(balance);
  };

  describe("AC1: an adjustment is a ledger entry with the admin, the reason and the amount", () => {
    it("add on a user: one adjustment entry (admin, action id, +N); the audit row of that id holds the reason; balance + N; invariants hold", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      const { adminId, cookie } = await signedIn("finance");

      const res = await adjust(cookie, bodyFor({ userId: user.id }));

      expect(res.statusCode).toBe(200);
      const [entry] = await adjustmentEntries();
      expect(await adjustmentEntries()).toHaveLength(1);
      expect(entry).toMatchObject({ wallet: "paid", memberUserId: adminId, reference: expect.any(String), idempotencyKey: expect.stringMatching(/^adjustment:/) });
      expect(entry.amount.toString()).toBe("10.5");
      expect(res.json()).toEqual({
        entryId: entry.id,
        accountId: entry.accountId,
        wallet: "paid",
        amount: "10.5",
        balanceAfter: "15.5",
        adminId,
        actionId: entry.reference,
        createdAt: entry.createdAt.toISOString(),
      });
      const audit = await prisma.adminAuditLog.findMany({ where: { requestId: entry.reference as string } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ adminId, resource: "credit_account", action: "adjust", reason: REASON });
      expect(audit[0].before).toEqual({ accountId: entry.accountId, userId: user.id, companyId: null, balance: "5" });
      expect(audit[0].after).toEqual({
        accountId: entry.accountId,
        userId: user.id,
        companyId: null,
        entryId: entry.id,
        actionId: entry.reference,
        direction: "add",
        amount: "10.5",
        balance: "15.5",
        ticketReference: "TCK-0001",
        paymentReference: null,
        replayed: false,
      });
      expect(await paidBalance({ userId: user.id })).toBe("15.5");
      expect(await assertCreditLedgerInvariants(prisma)).toBe(1);
    });

    it("remove on a user: the entry's amount is -N and the balance falls by N; invariants hold", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 20);
      const { cookie } = await signedIn("finance");

      const res = await adjust(cookie, bodyFor({ userId: user.id }, { amount: "7.25", direction: "remove", paymentReference: "pay_fake_01" }));

      expect(res.statusCode).toBe(200);
      const [entry] = await adjustmentEntries();
      expect(entry.amount.toString()).toBe("-7.25");
      expect(res.json()).toMatchObject({ amount: "-7.25", balanceAfter: "12.75" });
      expect(await paidBalance({ userId: user.id })).toBe("12.75");
      expect((await auditRows())[0].after).toMatchObject({ direction: "remove", amount: "-7.25", paymentReference: "pay_fake_01" });
      expect(await assertCreditLedgerInvariants(prisma)).toBe(1);
    });

    it("a company target: the entry goes to the company's paid wallet", async () => {
      const companyId = await createCompany();
      const { cookie } = await signedIn("finance");

      const res = await adjust(cookie, bodyFor({ companyId }, { amount: "3" }));

      expect(res.statusCode).toBe(200);
      const account = await prisma.creditAccount.findUniqueOrThrow({ where: { id: res.json().accountId } });
      expect(account).toMatchObject({ companyId, userId: null, wallet: "paid" });
      expect(account.balance.toString()).toBe("3");
      expect(await assertCreditLedgerInvariants(prisma)).toBe(1);
    });
  });

  describe("AC2: refused without a recent re-authentication or without credits:adjust, nothing written", () => {
    it.each([
      ["never re-authenticated", null],
      ["re-authenticated 3 minutes ago (window: 2)", 3 * MINUTE],
    ])("credits:adjust (finance) but %s: 403, no entry, no balance change, no audit row", async (_case, reauthAgo) => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      const { cookie } = await signedIn("finance", reauthAgo);

      const res = await adjust(cookie, bodyFor({ userId: user.id }));

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("Re-authentication required");
      await expectNothingWritten({ userId: user.id }, "5");
    });

    it("a recent re-authentication but no credits:adjust (operations): 403, no entry, no balance change, no audit row", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      const { cookie } = await signedIn("operations");

      const res = await adjust(cookie, bodyFor({ userId: user.id }));

      expect(res.statusCode).toBe(403);
      expect(res.json().message).not.toBe("Re-authentication required");
      await expectNothingWritten({ userId: user.id }, "5");
    });

    it("control: credits:adjust and a recent re-authentication: 200, one entry", async () => {
      const user = await createUser(prisma);
      const { cookie } = await signedIn("finance");

      const res = await adjust(cookie, bodyFor({ userId: user.id }));

      expect(res.statusCode).toBe(200);
      expect(await adjustmentEntries()).toHaveLength(1);
    });
  });

  describe("AC3: a replay with the same idempotency key leaves exactly one entry", () => {
    it("the same body and key twice: one entry, the balance moves once, the same response; the replay's audit row is marked and points at the first", async () => {
      const user = await createUser(prisma);
      const { cookie } = await signedIn("finance");
      const body = bodyFor({ userId: user.id });

      const first = await adjust(cookie, body);
      const second = await adjust(cookie, body);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      const entries = await adjustmentEntries();
      expect(entries).toHaveLength(1);
      expect(await paidBalance({ userId: user.id })).toBe("10.5");
      const [original, replay] = await auditRows();
      expect(original.requestId).toBe(entries[0].reference);
      expect(replay.requestId).not.toBe(entries[0].reference);
      expect(replay.after).toEqual({ ...(original.after as Json), replayed: true });
      expect(replay.before).toEqual(original.before);
      expect(await prisma.adminAuditLog.count({ where: { requestId: entries[0].reference as string } })).toBe(1);
      expect(await assertCreditLedgerInvariants(prisma)).toBe(1);
    });
  });

  describe("refused bodies and removals, nothing written", () => {
    it.each([
      ["no reason", { reason: undefined }],
      ["a blank reason", { reason: "   " }],
      ["amount 0", { amount: "0.000" }],
      ["a negative amount", { amount: "-5" }],
      ["a JSON number amount", { amount: 5 }],
      ["more than 6 decimals", { amount: "1.0000001" }],
      ["an unknown direction", { direction: "set" }],
      ["no idempotency key", { idempotencyKey: undefined }],
      ["both a user and a company", { target: { userId: "x", companyId: "y" } }],
      ["an unknown user", { target: { userId: randomUUID() } }],
      ["a company without a contract", { target: { companyId: randomUUID() } }],
    ])("%s: 400", async (_case, overrides) => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      const { cookie } = await signedIn("finance");

      const res = await adjust(cookie, bodyFor({ userId: user.id }, overrides));

      expect(res.statusCode).toBe(400);
      await expectNothingWritten({ userId: user.id }, "5");
    });

    it("a removal above the balance: refused (I5, 402), no entry, no balance change, no audit row", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);
      const { cookie } = await signedIn("finance");

      const res = await adjust(cookie, bodyFor({ userId: user.id }, { amount: "5.000001", direction: "remove" }));

      expect(res.statusCode).toBe(402);
      await expectNothingWritten({ userId: user.id }, "5");
      expect(await assertCreditLedgerInvariants(prisma)).toBe(1);
    });
  });
});
