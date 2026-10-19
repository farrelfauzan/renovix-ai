import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Prisma } from "@generated/prisma/client.js";
import { CreditLedgerService } from "./credit-ledger.service";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import type { CreditEntryInput } from "../types/credit-entry-input";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RX-20: the credit ledger (docs/credits.md section 2). Amounts are example values, not catalog values.

const credits = (value: string) => new Prisma.Decimal(value);

describe("CreditLedgerService.appendEntry (RX-20, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CreditLedgerService;
  let userId: string;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CreditLedgerService] }));
    service = moduleRef.get(CreditLedgerService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    userId = (await createUser(prisma)).id;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** A non-usage entry (plan_grant unless overridden) on the user's paid wallet. */
  const grant = (amount: string, key: string, override: Partial<CreditEntryInput> = {}): CreditEntryInput => ({
    owner: { userId },
    wallet: "paid",
    type: "plan_grant",
    amount: credits(amount),
    memberUserId: userId,
    reference: `ref-${key}`,
    idempotencyKey: key,
    ...override,
  });

  /** A usage entry (one model call) on the user's paid wallet, with every usage field set. */
  const usage = (amount: string, callId: string, override: Partial<CreditEntryInput> = {}): CreditEntryInput => ({
    owner: { userId },
    wallet: "paid",
    type: "usage",
    amount: credits(amount),
    memberUserId: userId,
    requestId: `req-${callId}`,
    callId,
    modelId: "test-model",
    tier: "standard",
    rateNew: 1,
    rateCached: 1,
    rateOut: 1,
    tokensNew: 10,
    tokensCached: 20,
    tokensOut: 5,
    outcome: "completed",
    idempotencyKey: callId,
    ...override,
  });

  const paidAccount = () => prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });

  /**
   * Holds every caller at TransactionService.run (before its transaction opens) until `callers` are waiting, then
   * releases them together, so their transactions overlap (docs/testing.md, "Race tests"). Held before the
   * transaction, not inside it: the pool has fewer connections than callers.
   */
  const holdCallersBeforeTransaction = (callers: number) => {
    const transactions = moduleRef.get(TransactionService);
    const run = transactions.run.bind(transactions);
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
    const heldRun = async (...args: Parameters<typeof run>) => {
      arrived += 1;
      if (arrived === callers) releaseAll();
      await allArrived;
      return run(...args);
    };
    jest.spyOn(transactions, "run").mockImplementation(heldRun as typeof run);
  };

  it("keeps balance = sum of entries, a gap-free seq and the balanceAfter chain on two owners and both wallets (I1, I2)", async () => {
    const pool = { companyId: `company-${randomUUID()}` };
    const memberId = (await createUser(prisma)).id;
    await service.appendEntry(grant("25", "pay-1"));
    await service.appendEntry(usage("-1.812570", "call-1"));
    await service.appendEntry(grant("5", "topup-1", { type: "top_up" }));
    await service.appendEntry(grant("0.5", "refund-1", { type: "refund" }));
    await service.appendEntry(grant("-1", "adjust-1", { type: "adjustment", memberUserId: "admin-1" }));
    await service.appendEntry(grant("2", "reset-1", { type: "weekly_reset", wallet: "weekly_free", reference: null }));
    await service.appendEntry(usage("-0.049558", "call-2", { wallet: "weekly_free" }));
    await service.appendEntry(usage("0", "call-3", { wallet: "weekly_free", outcome: "provider_error", uncharged: "0.015988" }));
    await service.appendEntry(grant("100", "pool-grant-1", { owner: pool, memberUserId: memberId }));
    await service.appendEntry(usage("-0.540307", "call-4", { owner: pool, memberUserId: memberId, runId: "run-1", agentId: "agent-1" }));
    await service.appendEntry(grant("3", "bonus-1", { type: "bonus" }));
    const actualChecked = await assertCreditLedgerInvariants(prisma);
    const accounts = await prisma.creditAccount.findMany({ orderBy: [{ companyId: "asc" }, { wallet: "asc" }] });
    expect(actualChecked).toBe(3);
    expect(accounts.map((a) => [a.userId ?? a.companyId, a.wallet, a.balance.toFixed(6), a.lastSeq])).toEqual([
      [pool.companyId, "paid", "99.459693", 2],
      [userId, "paid", "30.687430", 6],
      [userId, "weekly_free", "1.950442", 3],
    ]);
  });

  it("the invariant check fails on a ledger whose account row was not moved with its entry", async () => {
    const first = await service.appendEntry(grant("1", "pay-1"));
    await prisma.creditLedgerEntry.create({
      data: { accountId: first.accountId, wallet: "paid", seq: 2, type: "bonus", amount: 1, balanceAfter: 2, memberUserId: userId, reference: "ref", idempotencyKey: "bonus-1" },
    });
    await expect(assertCreditLedgerInvariants(prisma)).rejects.toThrow("Credit ledger invariants I1/I2 broken");
  });

  it("20 appends at the same moment on a new account: one account, seq 1..20 with no gap or duplicate, balance = their sum", async () => {
    const callers = 20;
    holdCallersBeforeTransaction(callers);
    const results = await Promise.allSettled(
      Array.from({ length: callers }, (_, i) => service.appendEntry(grant(`${i + 1}.000001`, `pay-${i}`))),
    );
    const actualSeqs = (await prisma.creditLedgerEntry.findMany({ orderBy: { seq: "asc" } })).map((e) => e.seq);
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await prisma.creditAccount.count()).toBe(1);
    expect(actualSeqs).toEqual(Array.from({ length: callers }, (_, i) => i + 1));
    expect((await paidAccount()).balance.toFixed(6)).toBe("210.000020");
    expect((await paidAccount()).lastSeq).toBe(callers);
    await assertCreditLedgerInvariants(prisma);
  });

  it("10 debits of 1 at the same moment on a balance of 5: five pass, five are refused, the balance ends at 0 (I5)", async () => {
    await service.appendEntry(grant("5", "pay-1"));
    holdCallersBeforeTransaction(10);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => service.appendEntry(grant("-1", `adjust-${i}`, { type: "adjustment" }))),
    );
    const refused = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason);
    expect(refused).toHaveLength(5);
    expect(refused.every((reason) => reason instanceof CreditsExhaustedException)).toBe(true);
    expect((await paidAccount()).balance.toFixed(6)).toBe("0.000000");
    expect((await paidAccount()).lastSeq).toBe(6);
    await assertCreditLedgerInvariants(prisma);
  });

  it("refuses an overdraw with 402 CREDITS_EXHAUSTED and writes nothing", async () => {
    await service.appendEntry(grant("1", "pay-1"));
    const before = await paidAccount();
    const refusal = service.appendEntry(grant("-1.000001", "adjust-1", { type: "adjustment" }));
    await expect(refusal).rejects.toBeInstanceOf(CreditsExhaustedException);
    await expect(refusal).rejects.toMatchObject({ status: 402, response: { code: "CREDITS_EXHAUSTED" } });
    expect(await paidAccount()).toEqual(before);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
  });

  it("refuses an entry that would leave the balance below the held credits, and accepts one that does not", async () => {
    await service.appendEntry(grant("1", "pay-1"));
    await prisma.$executeRaw`UPDATE "credit_accounts" SET "held" = 0.8`;
    await expect(service.appendEntry(usage("-0.200001", "call-1"))).rejects.toBeInstanceOf(CreditsExhaustedException);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
    await service.appendEntry(usage("-0.2", "call-2"));
    expect((await paidAccount()).balance.toFixed(6)).toBe("0.800000");
  });

  it("a replay of an idempotency key returns the first entry and writes nothing (I8)", async () => {
    const first = await service.appendEntry(grant("10", "xendit:pay-1"));
    const replay = await service.appendEntry(grant("10", "xendit:pay-1"));
    expect(replay).toEqual(first);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
    expect((await paidAccount()).balance.toFixed(6)).toBe("10.000000");
    expect((await paidAccount()).lastSeq).toBe(1);
  });

  it("refuses a second usage entry for the same call on another wallet with 409, and writes nothing (I3)", async () => {
    await service.appendEntry(usage("0", "call-1"));
    await expect(service.appendEntry(usage("0", "call-1", { wallet: "weekly_free" }))).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
    expect(await prisma.creditAccount.count()).toBe(1);
  });

  it("refuses an amount that is not whole micro-credits", async () => {
    await expect(service.appendEntry(grant("0.0000001", "pay-1"))).rejects.toThrow("whole micro-credits");
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  });

  it.each([
    ["a usage entry without its callId", () => usage("0", "call-1", { callId: null })],
    ["a usage entry that adds credits", () => usage("1", "call-1")],
    ["a grant with a model", () => grant("1", "pay-1", { modelId: "test-model" })],
  ])("refuses %s (usage fields CHECK)", async (_case, entry) => {
    await expect(service.appendEntry(entry())).rejects.toThrow("credit_ledger_entries_usage_fields_check");
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  });

  it("refuses a grant without a reference (reference CHECK)", async () => {
    await expect(service.appendEntry(grant("1", "pay-1", { reference: null }))).rejects.toThrow("credit_ledger_entries_reference_check");
  });

  it("refuses UPDATE and DELETE on ledger entries (append-only trigger, I7); TRUNCATE stays allowed", async () => {
    await service.appendEntry(grant("1", "pay-1"));
    await expect(prisma.$executeRaw`UPDATE "credit_ledger_entries" SET "amount" = 2`).rejects.toThrow("credit_ledger_entries is append-only: UPDATE is refused");
    await expect(prisma.$executeRaw`DELETE FROM "credit_ledger_entries"`).rejects.toThrow("credit_ledger_entries is append-only: DELETE is refused");
    expect((await prisma.creditLedgerEntry.findFirstOrThrow()).amount.toFixed(6)).toBe("1.000000");
    await resetDatabase(prisma);
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  });

  it.each([
    ["a negative balance", Prisma.sql`UPDATE "credit_accounts" SET "balance" = -1, "held" = 0`, "credit_accounts_balance_check"],
    ["held above the balance", Prisma.sql`UPDATE "credit_accounts" SET "held" = "balance" + 0.000001`, "credit_accounts_held_check"],
    ["a negative held", Prisma.sql`UPDATE "credit_accounts" SET "held" = -0.000001`, "credit_accounts_held_check"],
  ])("refuses %s written with raw SQL (I5 CHECK)", async (_case, statement, constraint) => {
    await service.appendEntry(grant("1", "pay-1"));
    const before = await paidAccount();
    await expect(prisma.$executeRaw(statement)).rejects.toThrow(constraint);
    expect(await paidAccount()).toEqual(before);
  });

  it.each([
    ["both a user and a company", (id: string) => ({ userId: id, companyId: "company-1" })],
    ["no owner", () => ({})],
  ])("refuses an account with %s (one-owner CHECK)", async (_case, owner) => {
    await expect(prisma.creditAccount.create({ data: { ...owner(userId), wallet: "paid" } })).rejects.toThrow("credit_accounts_one_owner_check");
    expect(await prisma.creditAccount.count()).toBe(0);
  });
});
