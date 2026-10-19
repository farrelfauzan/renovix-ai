import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Prisma } from "@generated/prisma/client.js";
import { CreditLedgerService } from "./credit-ledger.service";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import type { CreditEntryInput } from "../types/credit-entry-input";
import type { DbTransaction } from "../../prisma/db-transaction";
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

  // RX-20 follow-up (D203): NaN and infinite amounts, the sign of each entry type, conflicting replays, wallets.

  /**
   * Runs `work` in a transaction that is always rolled back, DDL included, and returns what it returned. Used to drop
   * a CHECK for one statement without changing the database the other tests see.
   */
  const inRolledBackTransaction = async <T>(work: (tx: DbTransaction) => Promise<T>): Promise<T> => {
    const rollback = new Error("rollback");
    let result!: T;
    await prisma
      .$transaction(async (tx) => {
        result = await work(tx);
        throw rollback;
      })
      .catch((err: unknown) => {
        if (err !== rollback) throw err;
      });
    return result;
  };

  /** Drops these [table, constraint] CHECKs inside `tx`. */
  const dropChecks = async (tx: DbTransaction, dropped: string[][]) => {
    for (const [table, constraint] of dropped) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DROP CONSTRAINT "${constraint}"`);
  };

  /** A raw insert of an adjustment entry, seq 2, on the user's paid account. */
  const rawEntry = (amount: string, balanceAfter: string, uncharged: string, type = "adjustment", wallet = "paid") => Prisma.sql`
    INSERT INTO "credit_ledger_entries" ("id", "account_id", "wallet", "seq", "type", "amount", "balance_after", "uncharged",
                                         "member_user_id", "reference", "idempotency_key")
    SELECT gen_random_uuid()::text, "id", ${wallet}::"CreditWallet", 2, ${type}::"CreditEntryType", ${amount}::numeric,
           ${balanceAfter}::numeric, ${uncharged}::numeric, ${userId}, 'ref-raw', 'raw-1'
    FROM "credit_accounts" WHERE "user_id" = ${userId} AND "wallet" = 'paid'`;

  /** A raw insert of a reservation on the user's paid account. */
  const rawReservation = (amountHeld: string, consumed: string, wallet = "paid") => Prisma.sql`
    INSERT INTO "credit_reservations" ("id", "account_id", "wallet", "request_id", "amount_held", "consumed", "expires_at", "updated_at")
    SELECT gen_random_uuid()::text, "id", ${wallet}::"CreditWallet", 'req-raw', ${amountHeld}::numeric, ${consumed}::numeric,
           now() + interval '1 hour', now()
    FROM "credit_accounts" WHERE "user_id" = ${userId} AND "wallet" = 'paid'`;

  it.each([["NaN"], ["Infinity"], ["-Infinity"]])(
    "refuses the amount %s before any transaction opens, and writes nothing",
    async (value) => {
      await service.appendEntry(grant("10", "pay-1"));
      const before = await paidAccount();
      const run = jest.spyOn(moduleRef.get(TransactionService), "run");
      await expect(service.appendEntry(grant(value, "bonus-1", { type: "bonus" }))).rejects.toThrow("A ledger amount must be a finite number");
      expect(run).not.toHaveBeenCalled();
      expect(await paidAccount()).toEqual(before);
      expect(await prisma.creditLedgerEntry.count()).toBe(1);
    },
  );

  it("QA's sequence cannot happen: a NaN bonus is refused, then a debit of 1,000,000 is refused (I5)", async () => {
    await service.appendEntry(grant("10", "pay-1"));
    await expect(service.appendEntry(grant("NaN", "bonus-1", { type: "bonus" }))).rejects.toThrow();
    await expect(service.appendEntry(usage("-1000000", "call-1"))).rejects.toBeInstanceOf(CreditsExhaustedException);
    expect((await paidAccount()).balance.toFixed(6)).toBe("10.000000");
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
    await assertCreditLedgerInvariants(prisma);
  });

  it.each([
    ["credit_accounts.balance", [], () => Prisma.sql`UPDATE "credit_accounts" SET "balance" = 'NaN'`, "credit_accounts_balance_not_nan_check"],
    ["credit_accounts.held", [["credit_accounts", "credit_accounts_held_check"]], () => Prisma.sql`UPDATE "credit_accounts" SET "held" = 'NaN'`, "credit_accounts_held_not_nan_check"],
    ["credit_ledger_entries.amount", [], () => rawEntry("NaN", "1", "0"), "credit_ledger_entries_amount_not_nan_check"],
    ["credit_ledger_entries.balance_after", [], () => rawEntry("0", "NaN", "0"), "credit_ledger_entries_balance_after_not_nan_check"],
    ["credit_ledger_entries.uncharged", [], () => rawEntry("0", "1", "NaN"), "credit_ledger_entries_uncharged_not_nan_check"],
    ["credit_reservations.amount_held", [], () => rawReservation("NaN", "0"), "credit_reservations_amount_held_not_nan_check"],
    ["credit_reservations.consumed", [["credit_reservations", "credit_reservations_consumed_check"]], () => rawReservation("1", "NaN"), "credit_reservations_consumed_not_nan_check"],
  ])("the database refuses a NaN %s written with raw SQL", async (_column, dropped, statement, constraint) => {
    // held and consumed: their I4/I5 CHECK also refuses this NaN, so it is dropped (rolled back) to test this one alone.
    await service.appendEntry(grant("1", "pay-1"));
    const actual = await inRolledBackTransaction(async (tx) => {
      await dropChecks(tx, dropped);
      return tx.$executeRaw(statement()).then(() => "accepted", (err: Error) => err.message);
    });
    expect(actual).toContain(constraint);
  });

  it.each([
    ["a top_up of -4", "top_up", "-4"],
    ["a plan_grant of -1", "plan_grant", "-1"],
    ["a bonus of -1", "bonus", "-1"],
    ["a bonus of 0", "bonus", "0"],
  ])("refuses %s, and writes nothing (sign CHECK)", async (_case, type, amount) => {
    await service.appendEntry(grant("10", "pay-1"));
    const before = await paidAccount();
    const entry = grant(amount, "bad-1", { type: type as CreditEntryInput["type"] });
    await expect(service.appendEntry(entry)).rejects.toThrow("credit_ledger_entries_amount_sign_check");
    expect(await paidAccount()).toEqual(before);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
  });

  it("accepts a negative refund (the docs do not fix a refund's sign)", async () => {
    await service.appendEntry(grant("10", "pay-1"));
    await service.appendEntry(grant("-0.5", "refund-1", { type: "refund" }));
    expect((await paidAccount()).balance.toFixed(6)).toBe("9.500000");
  });

  it.each([
    ["another amount", () => grant("9", "pay-1")],
    ["another type", () => grant("10", "pay-1", { type: "top_up" })],
  ])(
    "refuses a replay of an idempotency key with %s with 409, and writes nothing (I8)",
    async (_case, entry) => {
      await service.appendEntry(grant("10", "pay-1"));
      const before = await paidAccount();
      const replay = service.appendEntry(entry());
      await expect(replay).rejects.toBeInstanceOf(ConflictException);
      await expect(replay).rejects.toThrow("This idempotency key is already used by another ledger entry");
      expect(await paidAccount()).toEqual(before);
      expect(await prisma.creditLedgerEntry.count()).toBe(1);
    },
  );

  it("a replay with the same amount written at another scale still returns the first entry (I8)", async () => {
    const first = await service.appendEntry(grant("10", "pay-1"));
    expect(await service.appendEntry(grant("10.000000", "pay-1"))).toEqual(first);
  });

  it.each([
    ["an entry", () => rawEntry("1", "2", "0", "bonus", "weekly_free"), "credit_ledger_entries_account_id_wallet_fkey"],
    ["a reservation", () => rawReservation("1", "0", "weekly_free"), "credit_reservations_account_id_wallet_fkey"],
  ])("refuses %s whose wallet is not its account's wallet (composite foreign key)", async (_case, statement, constraint) => {
    await service.appendEntry(grant("1", "pay-1"));
    await expect(prisma.$executeRaw(statement())).rejects.toThrow(constraint);
    expect(await prisma.creditLedgerEntry.count()).toBe(1);
    expect(await prisma.creditReservation.count()).toBe(0);
  });

  it.each([
    [
      "a NaN balance and a NaN entry (QA's state)",
      [["credit_accounts", "credit_accounts_balance_not_nan_check"], ["credit_ledger_entries", "credit_ledger_entries_amount_not_nan_check"], ["credit_ledger_entries", "credit_ledger_entries_balance_after_not_nan_check"]],
      () => [rawEntry("NaN", "NaN", "0", "bonus"), Prisma.sql`UPDATE "credit_accounts" SET "balance" = 'NaN', "last_seq" = 2`],
    ],
    [
      "a NaN held",
      [["credit_accounts", "credit_accounts_held_check"], ["credit_accounts", "credit_accounts_held_not_nan_check"]],
      () => [Prisma.sql`UPDATE "credit_accounts" SET "held" = 'NaN'`],
    ],
    [
      "a NaN uncharged",
      [["credit_ledger_entries", "credit_ledger_entries_uncharged_not_nan_check"]],
      () => [rawEntry("0", "10", "NaN"), Prisma.sql`UPDATE "credit_accounts" SET "last_seq" = 2`],
    ],
  ])("the invariant check fails on %s written past the CHECKs", async (_case, dropped, statements) => {
    // The CHECKs are dropped inside a transaction that is rolled back, so the NaN never reaches the other tests.
    await service.appendEntry(grant("10", "pay-1"));
    const actual = await inRolledBackTransaction(async (tx) => {
      await dropChecks(tx, dropped);
      for (const statement of statements()) await tx.$executeRaw(statement);
      return assertCreditLedgerInvariants(tx).then(String, (err: Error) => err.message);
    });
    expect(actual).toContain('"nanFree":false');
  });
});
