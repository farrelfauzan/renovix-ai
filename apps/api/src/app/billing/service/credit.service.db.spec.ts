import { TestingModule } from "@nestjs/testing";
import { Prisma } from "@generated/prisma/client.js";
import { CreditService } from "./credit.service";
import { CreditsExhaustedException } from "../errors/credits-exhausted.exception";
import { CreditReservationRepository } from "../repository/credit-reservation.repository";
import type { UsageRecord } from "../types/usage-record";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";

// RX-22a: reserve, usage, settle, release and the expiry sweep on the credit ledger (docs/credits.md sections 2.2
// and 3). Amounts are example values, not catalog values.

const credits = (value: string) => new Prisma.Decimal(value);

describe("CreditService (RX-22, test database)", () => {
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
    // I1/I2 after every test that writes (docs/credits.md section 2.2); I5 is a CHECK on the account row.
    await assertCreditLedgerInvariants(prisma);
  });

  afterAll(() => moduleRef?.close());

  const reserve = (amount: string, requestId = "req-1") => service.reserve({ userId, requestId, amount: credits(amount) });

  /** A usage record at the standard rate 1/1/1: the call costs tokensNew + tokensCached + tokensOut micro-credits. */
  const usage = (reservationId: string, callId: string, override: Partial<UsageRecord> = {}): UsageRecord => ({
    reservationId,
    memberUserId: userId,
    requestId: "req-1",
    callId,
    modelId: "test-model",
    tier: "standard",
    rates: { rateNew: credits("1"), rateCached: credits("1"), rateOut: credits("1") },
    tokens: { tokensNew: 300_000, tokensCached: 0, tokensOut: 100_000 },
    outcome: "completed",
    ...override,
  });

  /** The paid account's balance, held and available, as fixed strings. */
  const paid = async () => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId, wallet: "paid" } } });
    return {
      balance: account.balance.toFixed(6),
      held: account.held.toFixed(6),
      available: account.balance.minus(account.held).toFixed(6),
    };
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

  describe("reserve", () => {
    it("AC: concurrent requests cannot take the balance below zero: 5 reserves of 0.3 on 1.0 at the same moment, exactly 3 win, 2 get 402", async () => {
      await fundPaidWallet(prisma, userId, "1.0");
      holdCallersBeforeTransaction(5);

      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => reserve("0.3", `req-${i}`)));

      const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
      expect(refused.map((r) => r.reason)).toEqual([expect.any(CreditsExhaustedException), expect.any(CreditsExhaustedException)]);
      expect(await paid()).toEqual({ balance: "1.000000", held: "0.900000", available: "0.100000" });
      expect(await prisma.creditReservation.count({ where: { status: "open" } })).toBe(3);
    });

    it("AC: 402 CREDITS_EXHAUSTED on an unaffordable reservation, with nothing written", async () => {
      await fundPaidWallet(prisma, userId, "0.5");

      const actual = reserve("0.500001");

      await expect(actual).rejects.toBeInstanceOf(CreditsExhaustedException);
      await expect(actual).rejects.toMatchObject({ status: 402, response: { code: "CREDITS_EXHAUSTED" } });
      expect(await paid()).toEqual({ balance: "0.500000", held: "0.000000", available: "0.500000" });
      expect(await prisma.creditReservation.count()).toBe(0);
    });

    it("402 for a user with no account (nothing created) and on a frozen wallet; an exact fit is allowed", async () => {
      await expect(reserve("0.000001")).rejects.toBeInstanceOf(CreditsExhaustedException);
      expect(await prisma.creditAccount.count()).toBe(0);
      await fundPaidWallet(prisma, userId, "1");
      await prisma.creditAccount.updateMany({ data: { frozen: true } });
      await expect(reserve("0.1")).rejects.toBeInstanceOf(CreditsExhaustedException);
      await prisma.creditAccount.updateMany({ data: { frozen: false } });

      const reservation = await reserve("1");

      expect(reservation).toMatchObject({ status: "open", wallet: "paid", requestId: "req-1" });
      expect(reservation.amountHeld.toFixed(6)).toBe("1.000000");
      expect(reservation.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(await paid()).toEqual({ balance: "1.000000", held: "1.000000", available: "0.000000" });
    });

    it.each(["NaN", "Infinity", "-0.1", "0.0000001"])("refuses the amount %s before any write", async (amount) => {
      await fundPaidWallet(prisma, userId, "1");

      await expect(reserve(amount)).rejects.toThrow(/credit amount/);
      expect(await prisma.creditReservation.count()).toBe(0);
    });
  });

  describe("recordUsage, settle and release", () => {
    it("example (a): usage from the hold, then settle releases the rest; balance and entry agree", async () => {
      await fundPaidWallet(prisma, userId, "23.187430");
      const reservation = await reserve("0.647956");
      const rates = { rateNew: credits("10"), rateCached: credits("20"), rateOut: credits("11") };

      const entry = await service.recordUsage(
        usage(reservation.id, "call_1002_1", { rates, tier: "premium", tokens: { tokensNew: 8_412, tokensCached: 21_733, tokensOut: 1_957 } }),
      );
      const afterUsage = await paid();
      await service.settle(reservation.id);

      expect([entry.seq, entry.type, entry.amount.toFixed(6), entry.balanceAfter.toFixed(6), entry.uncharged.toFixed(6)]).toEqual([
        2, "usage", "-0.540307", "22.647123", "0.000000",
      ]);
      expect([entry.requestId, entry.callId, entry.idempotencyKey, entry.modelId, entry.tier, entry.outcome]).toEqual([
        "req-1", "call_1002_1", "call_1002_1", "test-model", "premium", "completed",
      ]);
      expect([entry.rateNew?.toFixed(0), entry.rateCached?.toFixed(0), entry.rateOut?.toFixed(0)]).toEqual(["10", "20", "11"]);
      expect([entry.tokensNew, entry.tokensCached, entry.tokensOut]).toEqual([8_412, 21_733, 1_957]);
      expect(afterUsage).toEqual({ balance: "22.647123", held: "0.107649", available: "22.539474" });
      expect(await paid()).toEqual({ balance: "22.647123", held: "0.000000", available: "22.647123" });
      const settled = await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect([settled.status, settled.consumed.toFixed(6)]).toEqual(["settled", "0.540307"]);
    });

    it("an overrun beyond the hold is taken from available; what available cannot cover is uncharged; the balance never goes below 0 (I5)", async () => {
      await fundPaidWallet(prisma, userId, "0.5");
      const reservation = await reserve("0.3");

      const entry = await service.recordUsage(usage(reservation.id, "call-1", { tokens: { tokensNew: 600_000, tokensCached: 0, tokensOut: 100_000 } }));

      expect([entry.amount.toFixed(6), entry.balanceAfter.toFixed(6), entry.uncharged.toFixed(6)]).toEqual([
        "-0.500000", "0.000000", "0.200000",
      ]);
      expect(await paid()).toEqual({ balance: "0.000000", held: "0.000000", available: "0.000000" });
      expect((await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } })).consumed.toFixed(6)).toBe("0.300000");
    });

    it("a replay of the same callId writes nothing and returns the first entry (I8)", async () => {
      await fundPaidWallet(prisma, userId, "1");
      const reservation = await reserve("0.5");

      const first = await service.recordUsage(usage(reservation.id, "call-1"));
      const replay = await service.recordUsage(usage(reservation.id, "call-1"));

      expect(replay.id).toBe(first.id);
      expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(1);
      expect(await paid()).toEqual({ balance: "0.600000", held: "0.100000", available: "0.500000" });
    });

    it("AC: a provider error writes a usage entry of 0 with outcome provider_error and uncharged set, then release: balance unchanged", async () => {
      await fundPaidWallet(prisma, userId, "22.647123");
      const reservation = await reserve("0.019473");

      const entry = await service.finishCall(
        usage(reservation.id, "call_1004_1", { tokens: { tokensNew: 3_208, tokensCached: 12_169, tokensOut: 611 }, outcome: "provider_error" }),
      );

      expect([entry.amount.toFixed(6), entry.uncharged.toFixed(6), entry.balanceAfter.toFixed(6), entry.outcome]).toEqual([
        "0.000000", "0.015988", "22.647123", "provider_error",
      ]);
      expect(await paid()).toEqual({ balance: "22.647123", held: "0.000000", available: "22.647123" });
      expect((await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("released");
    });

    it("finishCall settles any other outcome (client_cancel); settle and release of a closed reservation change nothing", async () => {
      await fundPaidWallet(prisma, userId, "1");
      const reservation = await reserve("0.5");

      await service.finishCall(usage(reservation.id, "call-1", { outcome: "client_cancel" }));
      await service.release(reservation.id);
      await service.settle(reservation.id);

      expect((await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("settled");
      expect(await paid()).toEqual({ balance: "0.600000", held: "0.000000", available: "0.600000" });
    });

    it("release returns the whole hold and charges nothing", async () => {
      await fundPaidWallet(prisma, userId, "1");
      const reservation = await reserve("0.75");

      await service.release(reservation.id);

      expect(await paid()).toEqual({ balance: "1.000000", held: "0.000000", available: "1.000000" });
      expect(await prisma.creditLedgerEntry.count({ where: { type: "usage" } })).toBe(0);
    });
  });

  describe("the expiry sweep (docs/credits.md section 3.1 rule 8)", () => {
    const expire = (reservationId: string) =>
      prisma.creditReservation.update({ where: { id: reservationId }, data: { expiresAt: new Date(Date.now() - 1_000) } });

    it("AC: releases an expired open reservation once; an open one not yet expired and a settled one are left alone", async () => {
      await fundPaidWallet(prisma, userId, "1");
      const expired = await reserve("0.2", "req-expired");
      const fresh = await reserve("0.3", "req-fresh");
      const settled = await reserve("0.1", "req-settled");
      await service.settle(settled.id);
      await expire(expired.id);
      await expire(settled.id);

      const firstSweep = await service.expireOverdueReservations();
      const secondSweep = await service.expireOverdueReservations();

      expect([firstSweep, secondSweep]).toEqual([1, 0]);
      const statuses = await prisma.creditReservation.findMany({ orderBy: { requestId: "asc" } });
      expect(statuses.map((r) => [r.requestId, r.status])).toEqual([
        ["req-expired", "expired"],
        ["req-fresh", "open"],
        ["req-settled", "settled"],
      ]);
      expect(await paid()).toEqual({ balance: "1.000000", held: "0.300000", available: "0.700000" });
      expect(fresh.status).toBe("open");
    });

    it("AC: two sweeps at the same moment (several instances) release an expired reservation exactly once", async () => {
      await fundPaidWallet(prisma, userId, "1");
      const reservation = await reserve("0.4");
      await expire(reservation.id);
      const repository = moduleRef.get(CreditReservationRepository);
      const findExpired = repository.findExpiredOpenReservations.bind(repository);
      let arrived = 0;
      let releaseAll!: () => void;
      const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
      jest.spyOn(repository, "findExpiredOpenReservations").mockImplementation(async (...args) => {
        const batch = await findExpired(...args);
        arrived += 1;
        if (arrived === 2) releaseAll();
        await allArrived;
        return batch;
      });

      const results = await Promise.all([service.expireOverdueReservations(), service.expireOverdueReservations()]);

      expect(results.sort()).toEqual([0, 1]);
      expect(await paid()).toEqual({ balance: "1.000000", held: "0.000000", available: "1.000000" });
      expect((await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("expired");
    });

    it("a call that ends after the sweep expired its reservation is charged from available, not from the released hold", async () => {
      await fundPaidWallet(prisma, userId, "1");
      const reservation = await reserve("0.5");
      await expire(reservation.id);
      await service.expireOverdueReservations();

      await service.finishCall(usage(reservation.id, "call-late"));

      expect(await paid()).toEqual({ balance: "0.600000", held: "0.000000", available: "0.600000" });
      const closed = await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
      expect([closed.status, closed.consumed.toFixed(6)]).toEqual(["expired", "0.000000"]);
    });
  });
});
