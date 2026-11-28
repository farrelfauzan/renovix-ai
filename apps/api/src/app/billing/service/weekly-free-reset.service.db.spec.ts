import { randomUUID } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import { Prisma } from "@generated/prisma/client.js";
import type { CreditWallet } from "@generated/prisma/client.js";
import { UserRepository } from "../../auth/repository/user.repository";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CreditAccountRepository } from "../repository/credit-account.repository";
import type { UsageRecord } from "../types/usage-record";
import { CreditLedgerService } from "./credit-ledger.service";
import { CreditService } from "./credit.service";
import { WeeklyFreeResetService } from "./weekly-free-reset.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { fundWeeklyFreeWallet } from "../../../../test/fund-weekly-free-wallet";
import { assertCreditLedgerInvariants } from "../../../../test/credit-ledger-invariants";
import { captureLogLines } from "../../../../test/capture-log-lines";

// RNX-321: the weekly reset of the free allowance (D467, docs/credits.md section 6): balance = max(allowance, held),
// holds untouched, one weekly_reset entry per wallet per Asia/Jakarta ISO week. Amounts are example values.

const ALLOWANCE_SETTING = "weeklyFreeAllowanceCredits";
/** Monday 2026-11-30 00:00 WIB (still Sunday in UTC): ISO week 2026-W49. */
const NOW = new Date("2026-11-30T00:00:00+07:00");
const WEEK_KEY = "weekly_reset:2026-W49";
/** Two pages of users and one more: the service reads 100 users per page. */
const MORE_THAN_TWO_PAGES = 201;
/** Wallets reset by two runs at once in AC3. */
const CONCURRENT_WALLETS = 30;

const credits = (value: string) => new Prisma.Decimal(value);

describe("RNX-321: weekly free reset (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: WeeklyFreeResetService;
  let creditService: CreditService;
  let userId: string;

  const providers = [WeeklyFreeResetService, CreditLedgerService, CreditService, PlatformSettingsService];

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers }));
    service = moduleRef.get(WeeklyFreeResetService);
    creditService = moduleRef.get(CreditService);
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

  const setAllowance = (value: number) =>
    prisma.platformSetting.upsert({ where: { name: ALLOWANCE_SETTING }, create: { name: ALLOWANCE_SETTING, value }, update: { value } });

  /** One wallet's balance and held, as fixed strings; null when the user has no such wallet. */
  const walletOf = async (ownerId: string, wallet: CreditWallet) => {
    const account = await prisma.creditAccount.findUnique({ where: { userId_wallet: { userId: ownerId, wallet } } });
    return account && { balance: account.balance.toFixed(6), held: account.held.toFixed(6) };
  };

  /** One wallet's balance, held, lastSeq and number of entries. */
  const snapshotOf = async (ownerId: string, wallet: CreditWallet) => {
    const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId_wallet: { userId: ownerId, wallet } } });
    const entries = await prisma.creditLedgerEntry.count({ where: { accountId: account.id } });
    return { balance: account.balance.toFixed(6), held: account.held.toFixed(6), lastSeq: account.lastSeq, entries };
  };

  /** The user's weekly_reset entries written by the job (week keys only), as [amount, balanceAfter, idempotencyKey]. */
  const resetEntriesOf = async (ownerId: string) => {
    const rows = await prisma.creditLedgerEntry.findMany({
      where: { account: { userId: ownerId }, type: "weekly_reset", idempotencyKey: { startsWith: "weekly_reset:" } },
      orderBy: { seq: "asc" },
    });
    return rows.map((e) => [e.amount.toFixed(6), e.balanceAfter.toFixed(6), e.idempotencyKey]);
  };

  /** A completed call at the standard rate 1/1/1 costing `cost` credits (all new input tokens). */
  const usage = (reservationId: string, callId: string, cost: string): UsageRecord => ({
    reservationId,
    memberUserId: userId,
    requestId: "req-1",
    callId,
    modelId: "test-model",
    tier: "standard",
    rates: { rateNew: credits("1"), rateCached: credits("1"), rateOut: credits("1") },
    tokens: { tokensNew: credits(cost).times(1_000_000).toNumber(), tokensCached: 0, tokensOut: 0 },
    outcome: "completed",
  });

  it("AC1: a free wallet at 0.5 with an open hold of 0.3: the balance becomes the cap, the hold is untouched (available 1.7), then settles against weekly_free; paid is unchanged", async () => {
    await setAllowance(2);
    await fundWeeklyFreeWallet(prisma, userId, "0.5");
    await fundPaidWallet(prisma, userId, "5");
    const reservation = await creditService.reserve({ userId, requestId: "req-1", amount: credits("0.3"), spendsWeeklyFree: true });
    const paidBefore = await snapshotOf(userId, "paid");

    const actualWritten = await service.resetWeeklyFreeWallets(NOW);

    expect(actualWritten).toBe(1);
    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "2.000000", held: "0.300000" });
    expect(await resetEntriesOf(userId)).toEqual([["1.500000", "2.000000", WEEK_KEY]]);
    const actualHold = await prisma.creditReservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect([actualHold.wallet, actualHold.status, actualHold.amountHeld.toFixed(6), actualHold.consumed.toFixed(6)]).toEqual(["weekly_free", "open", "0.300000", "0.000000"]);
    await creditService.finishCall(usage(reservation.id, "call-1", "0.3"));
    const actualUsage = await prisma.creditLedgerEntry.findMany({ where: { type: "usage" } });
    expect(actualUsage.map((e) => [e.wallet, e.amount.toFixed(6), e.balanceAfter.toFixed(6)])).toEqual([["weekly_free", "-0.300000", "1.700000"]]);
    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "1.700000", held: "0.000000" });
    expect(await snapshotOf(userId, "paid")).toEqual(paidBefore);
  });

  it("AC2: a second run in the same week writes nothing new, even after credits were spent in between", async () => {
    await setAllowance(2);
    await fundWeeklyFreeWallet(prisma, userId, "0.5");
    expect(await service.resetWeeklyFreeWallets(NOW)).toBe(1);
    const reservation = await creditService.reserve({ userId, requestId: "req-1", amount: credits("0.4"), spendsWeeklyFree: true });
    await creditService.finishCall(usage(reservation.id, "call-1", "0.4"));
    const before = await snapshotOf(userId, "weekly_free");
    const wednesdaySameWeek = new Date("2026-12-02T09:00:00+07:00");

    const actualWritten = await service.resetWeeklyFreeWallets(wednesdaySameWeek);

    expect(actualWritten).toBe(0);
    expect(await snapshotOf(userId, "weekly_free")).toEqual(before);
    expect(await resetEntriesOf(userId)).toEqual([["1.500000", "2.000000", WEEK_KEY]]);
  });

  it("the next ISO week resets the wallet again, with its own key", async () => {
    await setAllowance(2);
    await service.resetWeeklyFreeWallets(NOW);
    const reservation = await creditService.reserve({ userId, requestId: "req-1", amount: credits("0.4"), spendsWeeklyFree: true });
    await creditService.finishCall(usage(reservation.id, "call-1", "0.4"));

    const actualWritten = await service.resetWeeklyFreeWallets(new Date("2026-12-07T00:00:00+07:00"));

    expect(actualWritten).toBe(1);
    expect(await resetEntriesOf(userId)).toEqual([
      ["2.000000", "2.000000", WEEK_KEY],
      ["0.400000", "2.000000", "weekly_reset:2026-W50"],
    ]);
  });

  it("AC3: two runs started at the same time on two connection pools leave exactly one weekly_reset entry per wallet, seq gapless", async () => {
    const other = await createTestModule({ providers });
    try {
      await setAllowance(2);
      const userIds = [userId];
      for (let i = 1; i < CONCURRENT_WALLETS; i++) userIds.push((await createUser(prisma)).id);
      // Every third user has no weekly_free wallet yet (both runs race to create it); the others hold 0.1 to 3.
      for (const [i, id] of userIds.entries()) if (i % 3 !== 0) await fundWeeklyFreeWallet(prisma, id, (i / 10).toFixed(1));

      const actualWritten = await Promise.all([
        service.resetWeeklyFreeWallets(NOW),
        other.moduleRef.get(WeeklyFreeResetService).resetWeeklyFreeWallets(NOW),
      ]);

      expect(actualWritten[0] + actualWritten[1]).toBe(CONCURRENT_WALLETS);
      for (const id of userIds) {
        expect(await resetEntriesOf(id)).toEqual([[expect.any(String), "2.000000", WEEK_KEY]]);
        expect(await walletOf(id, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
      }
      expect(await assertCreditLedgerInvariants(prisma)).toBe(CONCURRENT_WALLETS);
    } finally {
      await other.moduleRef.close();
    }
  });

  it("AC4: with the setting row deleted, no wallet changes, none is created, and a log line names the setting", async () => {
    await setAllowance(2);
    await prisma.platformSetting.delete({ where: { name: ALLOWANCE_SETTING } });
    await fundWeeklyFreeWallet(prisma, userId, "0.5");
    const withoutWallet = await createUser(prisma);
    const accountsBefore = await prisma.creditAccount.findMany({ orderBy: { id: "asc" } });
    const entriesBefore = await prisma.creditLedgerEntry.count();
    const usersRead = jest.spyOn(moduleRef.get(UserRepository), "findActiveUserIdsAfter");
    const { lines } = captureLogLines();

    const actualWritten = await service.resetWeeklyFreeWallets(NOW);

    expect(actualWritten).toBe(0);
    expect(await prisma.creditAccount.findMany({ orderBy: { id: "asc" } })).toEqual(accountsBefore);
    expect(await prisma.creditLedgerEntry.count()).toBe(entriesBefore);
    expect(await walletOf(withoutWallet.id, "weekly_free")).toBeNull();
    expect(usersRead).not.toHaveBeenCalled();
    expect(lines.filter((line) => line.includes(ALLOWANCE_SETTING))).toHaveLength(1);
  });

  it("AC5: a user without a weekly_free wallet gets one, at the cap", async () => {
    await setAllowance(2);
    expect(await walletOf(userId, "weekly_free")).toBeNull();

    const actualWritten = await service.resetWeeklyFreeWallets(NOW);

    expect(actualWritten).toBe(1);
    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
    expect(await resetEntriesOf(userId)).toEqual([["2.000000", "2.000000", WEEK_KEY]]);
  });

  it("the cap was lowered: available above the cap comes down to the cap (a negative entry, no carry-over)", async () => {
    await setAllowance(2);
    await fundWeeklyFreeWallet(prisma, userId, "5");

    await service.resetWeeklyFreeWallets(NOW);

    expect(await resetEntriesOf(userId)).toEqual([["-3.000000", "2.000000", WEEK_KEY]]);
    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
  });

  it("a hold released after the reset leaves available at the cap, not above it", async () => {
    await setAllowance(2);
    await fundWeeklyFreeWallet(prisma, userId, "0.5");
    const reservation = await creditService.reserve({ userId, requestId: "req-1", amount: credits("0.3"), spendsWeeklyFree: true });
    await service.resetWeeklyFreeWallets(NOW);

    await creditService.release(reservation.id);

    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
  });

  it("an open hold larger than the allowance: the wallet stays at the held amount, the hold untouched", async () => {
    await setAllowance(2);
    await fundWeeklyFreeWallet(prisma, userId, "5");
    await creditService.reserve({ userId, requestId: "req-1", amount: credits("3"), spendsWeeklyFree: true });

    await service.resetWeeklyFreeWallets(NOW);

    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "3.000000", held: "3.000000" });
    expect(await resetEntriesOf(userId)).toEqual([["-2.000000", "3.000000", WEEK_KEY]]);
  });

  it("a wallet already at the cap still gets this week's entry, of 0", async () => {
    await setAllowance(2);
    await fundWeeklyFreeWallet(prisma, userId, "2");

    expect(await service.resetWeeklyFreeWallets(NOW)).toBe(1);

    expect(await resetEntriesOf(userId)).toEqual([["0.000000", "2.000000", WEEK_KEY]]);
  });

  it("paid wallets are never touched: balance, held and entries of a paid wallet with an open hold stay the same", async () => {
    await setAllowance(2);
    await fundPaidWallet(prisma, userId, "5");
    await creditService.reserve({ userId, requestId: "req-paid", amount: credits("1") });
    const paidBefore = await snapshotOf(userId, "paid");

    await service.resetWeeklyFreeWallets(NOW);

    expect(await snapshotOf(userId, "paid")).toEqual(paidBefore);
    expect(paidBefore).toMatchObject({ balance: "5.000000", held: "1.000000" });
  });

  it("only active users are reset: a suspended or deleted user's wallet is left as it is, and none is created for them", async () => {
    await setAllowance(2);
    const suspended = await createUser(prisma, { status: "suspended" });
    const deleted = await createUser(prisma, { status: "deleted" });
    const deletedWithoutWallet = await createUser(prisma, { status: "deleted" });
    await fundWeeklyFreeWallet(prisma, suspended.id, "0.5");
    await fundWeeklyFreeWallet(prisma, deleted.id, "0.5");

    const actualWritten = await service.resetWeeklyFreeWallets(NOW);

    expect(actualWritten).toBe(1);
    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
    expect(await walletOf(suspended.id, "weekly_free")).toEqual({ balance: "0.500000", held: "0.000000" });
    expect(await walletOf(deleted.id, "weekly_free")).toEqual({ balance: "0.500000", held: "0.000000" });
    expect(await walletOf(deletedWithoutWallet.id, "weekly_free")).toBeNull();
  });

  it("one wallet failing does not end the run: the others are reset, the failed one is left as it was and the failures are logged as a count", async () => {
    await setAllowance(2);
    const failing = await createUser(prisma);
    const later = await createUser(prisma);
    await fundWeeklyFreeWallet(prisma, failing.id, "0.5");
    const accounts = moduleRef.get(CreditAccountRepository);
    const lockOrCreateAccount = accounts.lockOrCreateAccount.bind(accounts);
    jest.spyOn(accounts, "lockOrCreateAccount").mockImplementation((owner, wallet, tx) =>
      "userId" in owner && owner.userId === failing.id ? Promise.reject(new Error("transaction timed out")) : lockOrCreateAccount(owner, wallet, tx),
    );
    const { lines } = captureLogLines();

    const actualWritten = await service.resetWeeklyFreeWallets(NOW);

    expect(actualWritten).toBe(2);
    expect(await walletOf(userId, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
    expect(await walletOf(later.id, "weekly_free")).toEqual({ balance: "2.000000", held: "0.000000" });
    expect(await walletOf(failing.id, "weekly_free")).toEqual({ balance: "0.500000", held: "0.000000" });
    expect(await resetEntriesOf(failing.id)).toEqual([]);
    const failureLines = lines.filter((line) => line.includes("1 wallet(s) failed"));
    expect(failureLines).toHaveLength(1);
    expect(failureLines[0]).not.toContain(failing.id);
  });

  it("pages through more users than one batch holds, resetting each exactly once", async () => {
    await setAllowance(2);
    await prisma.user.createMany({
      data: Array.from({ length: MORE_THAN_TWO_PAGES - 1 }, () => ({ email: `user-${randomUUID()}@test.local` })),
    });

    const actualWritten = await service.resetWeeklyFreeWallets(NOW);

    expect(actualWritten).toBe(MORE_THAN_TWO_PAGES);
    expect(await prisma.creditLedgerEntry.count({ where: { idempotencyKey: WEEK_KEY } })).toBe(MORE_THAN_TWO_PAGES);
    expect(await prisma.creditAccount.count({ where: { wallet: "weekly_free", balance: credits("2") } })).toBe(MORE_THAN_TWO_PAGES);
  });
});
