import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { Prisma } from "@generated/prisma/client.js";
import type { CreditWallet } from "@generated/prisma/client.js";
import { CreditService } from "./credit.service";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import type { UsageRecord } from "../types/usage-record";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { fundWeeklyFreeWallet } from "../../../../test/fund-weekly-free-wallet";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RNX-58a: a hold taken from two wallets, weekly_free first, then paid (CreditService.reserve with spendsWeeklyFree);
// each part settles to its own wallet with its own usage entry (decision 5a). Amounts are example values.

const credits = (value: string) => new Prisma.Decimal(value);

describe("RNX-58a: two-wallet holds, weekly_free then paid (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CreditService;
  let userId: string;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CreditService] }));
    service = moduleRef.get(CreditService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    userId = (await createUser(prisma)).id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await assertCreditLedgerInvariants(prisma);
  });

  afterAll(() => moduleRef?.close());

  const reserve = (amount: string, requestId = "req-1") =>
    service.reserve({ userId, requestId, amount: credits(amount), spendsWeeklyFree: true });

  /** A completed call at the standard rate 1/1/1 costing `cost` credits (all new input tokens). */
  const usage = (reservationId: string, callId: string, cost: string, override: Partial<UsageRecord> = {}): UsageRecord => ({
    reservationId,
    memberUserId: userId,
    requestId: "req-1",
    callId,
    modelId: "test-model",
    tier: "standard",
    rates: { rateNew: credits("1"), rateCached: credits("1"), rateOut: credits("1") },
    tokens: { tokensNew: credits(cost).times(1_000_000).toNumber(), tokensCached: 0, tokensOut: 0 },
    outcome: "completed",
    ...override,
  });

  /** One wallet's balance and held, as fixed strings; null when the user has no such wallet. */
  const wallet = async (name: CreditWallet) => {
    const account = await prisma.creditAccount.findUnique({ where: { userId_wallet: { userId, wallet: name } } });
    return account && { balance: account.balance.toFixed(6), held: account.held.toFixed(6) };
  };

  /** The reservations as [wallet, amountHeld, consumed, status, part of the first one]. */
  const reservations = async () => {
    const rows = await prisma.creditReservation.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((r) => [r.wallet, r.amountHeld.toFixed(6), r.consumed.toFixed(6), r.status, r.partOfId === null ? null : r.partOfId === rows[0].id]);
  };

  /** The usage entries as [wallet, callId, amount, balanceAfter, uncharged], weekly_free first. */
  const usageEntries = async () => {
    const rows = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" }, orderBy: [{ wallet: "desc" }, { seq: "asc" }] });
    return rows.map((e) => [e.wallet, e.callId, e.amount.toFixed(6), e.balanceAfter.toFixed(6), e.uncharged.toFixed(6)]);
  };

  /** Holds every caller at TransactionService.run (before its transaction opens) until `callers` wait (docs/testing.md). */
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

  describe("AC2: 1 weekly_free left and paid credit available", () => {
    it("a call reserving 3 holds 1 on weekly_free and 2 on paid; each part settles to its own wallet, a usage entry per part, no unique-index error", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "5");

      const reservation = await reserve("3");

      expect(reservation).toMatchObject({ wallet: "weekly_free", partOfId: null });
      expect(await reservations()).toEqual([
        ["weekly_free", "1.000000", "0.000000", "open", null],
        ["paid", "2.000000", "0.000000", "open", true],
      ]);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "1.000000", held: "1.000000" },
        { balance: "5.000000", held: "2.000000" },
      ]);

      const entry = await service.finishCall(usage(reservation.id, "call-1", "3"));

      expect(await usageEntries()).toEqual([
        ["weekly_free", "call-1:weekly_free", "-1.000000", "0.000000", "0.000000"],
        ["paid", "call-1", "-2.000000", "3.000000", "0.000000"],
      ]);
      expect([entry.wallet, entry.callId]).toEqual(["paid", "call-1"]);
      expect(await reservations()).toEqual([
        ["weekly_free", "1.000000", "1.000000", "settled", null],
        ["paid", "2.000000", "2.000000", "settled", true],
      ]);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "0.000000", held: "0.000000" },
        { balance: "3.000000", held: "0.000000" },
      ]);
    });

    it("a call cheaper than the hold: weekly_free is spent first, paid only for the rest, and settle releases what is left of paid's part", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "5");
      const reservation = await reserve("3");

      await service.finishCall(usage(reservation.id, "call-1", "1.5"));

      expect(await usageEntries()).toEqual([
        ["weekly_free", "call-1:weekly_free", "-1.000000", "0.000000", "0.000000"],
        ["paid", "call-1", "-0.500000", "4.500000", "0.000000"],
      ]);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "0.000000", held: "0.000000" },
        { balance: "4.500000", held: "0.000000" },
      ]);
    });

    it("a replay of the call returns its last entry and writes nothing; another call under that callId is a 409, nothing written", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "5");
      const reservation = await reserve("3");
      const first = await service.recordUsage(usage(reservation.id, "call-1", "3"));

      const replay = await service.recordUsage(usage(reservation.id, "call-1", "3"));

      expect(replay).toEqual(first);
      await expect(service.recordUsage(usage(reservation.id, "call-1", "2"))).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(2);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "0.000000", held: "0.000000" },
        { balance: "3.000000", held: "0.000000" },
      ]);
    });

    it("a provider error is one entry of 0 on the last part (paid), all of it uncharged, and both parts are released", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "5");
      const reservation = await reserve("3");

      await service.finishCall(usage(reservation.id, "call-1", "3", { outcome: "provider_error" }));

      expect(await usageEntries()).toEqual([["paid", "call-1", "0.000000", "5.000000", "3.000000"]]);
      expect((await reservations()).map(([w, , , status]) => [w, status])).toEqual([
        ["weekly_free", "released"],
        ["paid", "released"],
      ]);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "1.000000", held: "0.000000" },
        { balance: "5.000000", held: "0.000000" },
      ]);
    });

    it("release returns both parts' holds and charges nothing", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "5");
      const reservation = await reserve("3");

      await service.release(reservation.id);

      expect((await reservations()).map(([w, , , status]) => [w, status])).toEqual([
        ["weekly_free", "released"],
        ["paid", "released"],
      ]);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "1.000000", held: "0.000000" },
        { balance: "5.000000", held: "0.000000" },
      ]);
    });

    it("the expiry sweep releases both parts once", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "5");
      await reserve("3");

      const expired = await service.expireOverdueReservations(new Date(Date.now() + 60 * 60_000));

      expect(expired).toBe(2);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "1.000000", held: "0.000000" },
        { balance: "5.000000", held: "0.000000" },
      ]);
    });
  });

  it("2 weekly_free cover the hold: one weekly_free reservation, no paid part, the call is charged to weekly_free and paid is unchanged", async () => {
    await fundWeeklyFreeWallet(prisma, userId, "2");
    await fundPaidWallet(prisma, userId, "5");
    const reservation = await reserve("1");

    await service.finishCall(usage(reservation.id, "call-1", "0.4"));

    expect(await reservations()).toEqual([["weekly_free", "1.000000", "0.400000", "settled", null]]);
    expect(await usageEntries()).toEqual([["weekly_free", "call-1", "-0.400000", "1.600000", "0.000000"]]);
    expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
      { balance: "1.600000", held: "0.000000" },
      { balance: "5.000000", held: "0.000000" },
    ]);
  });

  describe("negative cases", () => {
    it("a user without a weekly_free wallet (it is created at sign-up): the hold is paid only and no wallet is created here", async () => {
      await fundPaidWallet(prisma, userId, "5");

      const reservation = await reserve("1");

      expect(reservation).toMatchObject({ wallet: "paid", partOfId: null });
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([null, { balance: "5.000000", held: "1.000000" }]);
    });

    it("an empty weekly_free wallet (balance 0): the hold is paid only", async () => {
      await prisma.creditAccount.create({ data: { userId, wallet: "weekly_free" } });
      await fundPaidWallet(prisma, userId, "5");

      await reserve("1");

      expect(await reservations()).toEqual([["paid", "1.000000", "0.000000", "open", null]]);
      expect(await wallet("weekly_free")).toEqual({ balance: "0.000000", held: "0.000000" });
    });

    it("a frozen weekly_free wallet is not used: the hold is paid only", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "2");
      await fundPaidWallet(prisma, userId, "5");
      await prisma.creditAccount.updateMany({ where: { wallet: "weekly_free" }, data: { frozen: true } });

      await reserve("1");

      expect(await reservations()).toEqual([["paid", "1.000000", "0.000000", "open", null]]);
    });

    it("no weekly_free and no paid credit: 402 as today, nothing written (no wallet created, no reservation)", async () => {
      await expect(reserve("0.1")).rejects.toBeInstanceOf(CreditsExhaustedException);

      expect(await prisma.creditAccount.count()).toBe(0);
      expect(await prisma.creditReservation.count()).toBe(0);
    });

    it("weekly_free and paid together cannot cover the hold: 402, nothing held on either wallet", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "1");

      await expect(reserve("2.000001")).rejects.toBeInstanceOf(CreditsExhaustedException);

      expect(await prisma.creditReservation.count()).toBe(0);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "1.000000", held: "0.000000" },
        { balance: "1.000000", held: "0.000000" },
      ]);
    });

    it("a hold without spendsWeeklyFree (agent runs, channel chat, reminders, public API) never touches weekly_free", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "2");
      await fundPaidWallet(prisma, userId, "5");

      const reservation = await service.reserve({ userId, requestId: "req-1", amount: credits("1") });
      await service.finishCall(usage(reservation.id, "call-1", "0.4"));

      expect(await reservations()).toEqual([["paid", "1.000000", "0.400000", "settled", null]]);
      expect(await usageEntries()).toEqual([["paid", "call-1", "-0.400000", "4.600000", "0.000000"]]);
      expect(await wallet("weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
    });

    it("concurrent requests cannot overdraw either wallet: 5 holds of 0.5 on 1 weekly_free + 1 paid, exactly 4 win, 1 gets 402", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "1");
      holdCallersBeforeTransaction(5);

      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => reserve("0.5", `req-${i}`)));

      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
      expect(refused.map((r) => r.reason)).toEqual([expect.any(CreditsExhaustedException)]);
      expect([await wallet("weekly_free"), await wallet("paid")]).toEqual([
        { balance: "1.000000", held: "1.000000" },
        { balance: "1.000000", held: "1.000000" },
      ]);
    });
  });

  describe("assertAvailable (the pre-check before any paid work)", () => {
    it("with spendsWeeklyFree, weekly_free and paid available count together; without it, paid only", async () => {
      await fundWeeklyFreeWallet(prisma, userId, "1");
      await fundPaidWallet(prisma, userId, "1");

      await expect(service.assertAvailable(userId, credits("2"), true)).resolves.toBeUndefined();
      await expect(service.assertAvailable(userId, credits("2.000001"), true)).rejects.toBeInstanceOf(CreditsExhaustedException);
      await expect(service.assertAvailable(userId, credits("1.000001"))).rejects.toBeInstanceOf(CreditsExhaustedException);
    });

    it("no wallet at all: 402, nothing created", async () => {
      await expect(service.assertAvailable(userId, credits("0.000001"), true)).rejects.toBeInstanceOf(CreditsExhaustedException);
      expect(await prisma.creditAccount.count()).toBe(0);
    });
  });
});
