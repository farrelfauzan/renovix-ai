import { randomUUID } from "node:crypto";
import { TestingModule } from "@nestjs/testing";
import type { CreditEntryType } from "@generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { captureLogLines } from "../../../../test/capture-log-lines";
import { createAgent, createUser } from "../../../../test/factories";
import { seedAccount, seedCall } from "../../../../test/usage-seed";
import { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";
import { CREDIT_WARNING_EMAIL } from "../../email/config/credit-warning-email";
import type { CreditWarningEmailPayload } from "../../email/types/credit-warning-email-payload";
import { buildCreditWarningEmail } from "../../email/utils/build-credit-warning-email";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { ReminderRepository } from "../../reminder/repository/reminder.repository";
import { CREDIT_METER_SETTING_NAMES } from "../config/credit-meter-setting-names";
import { CREDIT_WARNING_CHECK } from "../config/credit-warning-check";
import { RED_STATE_REMINDER_LIMIT } from "../config/red-state-reminder-limit";
import { CreditWarningRepository } from "../repository/credit-warning.repository";
import { CreditWarningService } from "./credit-warning.service";

// RNX-329: the hourly run-out warning check on the test database, through the real service, repositories and
// PlatformSettingsService. Every threshold uses a NON-default value (seeded: amber 7, red 2, floor 1, perRunCreditCap 10,
// projectionMinSpendCredits 1, projectionMaxDays 365), as in the credit meter spec (D83).
const SETTINGS = {
  runOutAmberDays: 10,
  runOutRedDays: 3,
  runOutFloorCredits: 5,
  perRunCreditCap: 7,
  projectionMinSpendCredits: 2,
  projectionMaxDays: 30,
} as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 3.5 paid credits spent on each of the last 4 days: 14 in the 7-day window, a rate of 2 credits a day. */
const USAGE_DAYS = [1, 2, 3, 4] as const;
const USAGE_PER_DAY = "3.5";
/** Available paid credits for each state at 2 credits a day: amber (8 days), red (3 days), red and below the floor 5. */
const BALANCE = { amber: "16", red: "6", redBelowFloor: "4" } as const;
/** How long the race test holds each run after its read, waiting for the other run's read. */
const RACE_HOLD_MS = 2000;

type Owner = { id: string; email: string };

describe("CreditWarningService.runCheck (RNX-329, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: CreditWarningService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CreditWarningService, PlatformSettingsService] }));
    service = moduleRef.get(CreditWarningService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.platformSetting.createMany({ data: Object.entries(SETTINGS).map(([name, value]) => ({ name, value })) });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => moduleRef?.close());

  /** One ledger entry of this type on the account, at `at` (default: the database's now(), to the microsecond). */
  const addEntry = (accountId: string, wallet: "paid" | "weekly_free", type: CreditEntryType, memberUserId: string, at?: Date) => {
    const key = `test-${type}:${randomUUID()}`;
    return prisma.$executeRaw`
      INSERT INTO credit_ledger_entries (id, account_id, wallet, seq, type, amount, balance_after, member_user_id, reference, idempotency_key, created_at)
      VALUES (${randomUUID()}, ${accountId}, ${wallet}::"CreditWallet",
        (SELECT COALESCE(max(seq), 0) + 1 FROM credit_ledger_entries WHERE account_id = ${accountId}), ${type}::"CreditEntryType",
        10, 0, ${memberUserId}, ${key}, ${key}, COALESCE(${at ?? null}::timestamptz, now()))`;
  };

  /** Sets the account's balance (held stays 0). */
  const setBalance = (accountId: string, balance: string) => prisma.creditAccount.update({ where: { id: accountId }, data: { balance } });

  /** `credits` of usage on the account on each of the days `daysAgo`. */
  const spendOnDays = async (accountId: string, wallet: "paid" | "weekly_free", userId: string, credits: string, daysAgo: readonly number[]) => {
    for (const days of daysAgo) {
      await seedCall(prisma, {
        accountId,
        wallet,
        memberUserId: userId,
        credits,
        at: new Date(Date.now() - days * DAY_MS).toISOString(),
        providerId: null,
        model: "test-model",
        tier: "standard",
        tokens: { new: 1, cached: 0, out: 1, reasoning: null },
        cost: { lowUsd: null, highUsd: null, lowIdr: null, highIdr: null },
      });
    }
  };

  /** A user with a paid wallet of `balance`, a top_up 10 days ago and 2 credits a day of paid usage; returns the account id. */
  const seedPaidUser = async (balance: string, timezone = "Asia/Jakarta"): Promise<{ owner: Owner; accountId: string }> => {
    const owner = await createUser(prisma, { timezone });
    const accountId = await seedAccount(prisma, { userId: owner.id, wallet: "paid" });
    await setBalance(accountId, balance);
    await addEntry(accountId, "paid", "top_up", owner.id, new Date(Date.now() - 10 * DAY_MS));
    await spendOnDays(accountId, "paid", owner.id, USAGE_PER_DAY, USAGE_DAYS);
    return { owner, accountId };
  };

  /** The queued warning mails, oldest first, as [recipient, level]. */
  const queuedMails = async (): Promise<Array<[string, string]>> => {
    const jobs = await prisma.emailJob.findMany({ orderBy: { createdAt: "asc" } });
    return jobs.map((job) => [job.recipientEmail, (job.payload as unknown as CreditWarningEmailPayload).level]);
  };

  /** A channel, agent and room of this user, for its reminders. */
  const seedRoom = async (userId: string) => {
    const agent = await createAgent(prisma, { userId });
    const channel = await prisma.channel.create({ data: { userId, name: "Room" } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    return { userId, agentId: agent.id, channelId: channel.id, chatRoomId: room.id };
  };

  const addReminder = (room: Awaited<ReturnType<typeof seedRoom>>, description: string, inDays: number) =>
    prisma.reminder.create({
      data: { ...room, prompt: description, description, cronExpression: "0 8 * * *", nextRunAt: new Date(Date.now() + inDays * DAY_MS) },
    });

  describe("AC1: each warning once per purchase cycle", () => {
    it("amber, then red, then floor, each check run twice: each mail is queued once, to the owner", async () => {
      const { owner, accountId } = await seedPaidUser(BALANCE.amber);

      await service.runCheck();
      await service.runCheck();
      const actualAfterAmber = await queuedMails();
      await setBalance(accountId, BALANCE.red);
      await service.runCheck();
      await service.runCheck();
      const actualAfterRed = await queuedMails();
      await setBalance(accountId, BALANCE.redBelowFloor);
      await service.runCheck();
      await service.runCheck();

      expect(actualAfterAmber).toEqual([[owner.email, "amber"]]);
      expect(actualAfterRed).toEqual([[owner.email, "amber"], [owner.email, "red"]]);
      expect(await queuedMails()).toEqual([[owner.email, "amber"], [owner.email, "red"], [owner.email, "floor"]]);
      expect(await prisma.creditWarning.count()).toBe(3);
      const job = await prisma.emailJob.findFirstOrThrow();
      expect(job.type).toBe(CREDIT_WARNING_EMAIL);
    });

    it.each<CreditEntryType>(["top_up", "plan_grant"])("a later paid %s entry starts a new cycle: red and floor are queued again", async (type) => {
      const { owner, accountId } = await seedPaidUser(BALANCE.redBelowFloor);
      await service.runCheck();

      await addEntry(accountId, "paid", type, owner.id);
      await service.runCheck();
      await service.runCheck();

      expect(await queuedMails()).toEqual([
        [owner.email, "red"], [owner.email, "floor"], [owner.email, "red"], [owner.email, "floor"],
      ]);
      expect(await prisma.creditWarning.count()).toBe(4);
    });

    it.each<CreditEntryType>(["bonus", "adjustment"])("a later %s entry is not a purchase: nothing is queued again", async (type) => {
      const { owner, accountId } = await seedPaidUser(BALANCE.redBelowFloor);
      await service.runCheck();

      await addEntry(accountId, "paid", type, owner.id);
      await service.runCheck();

      expect(await queuedMails()).toEqual([[owner.email, "red"], [owner.email, "floor"]]);
    });

    it("straight to red: no amber; back to amber after red in the same cycle: still no amber", async () => {
      // The cycle's top_up at the database's now() (microseconds): the queued red must still be found in the cycle.
      const owner = await createUser(prisma);
      const accountId = await seedAccount(prisma, { userId: owner.id, wallet: "paid" });
      await setBalance(accountId, BALANCE.red);
      await addEntry(accountId, "paid", "top_up", owner.id);
      await spendOnDays(accountId, "paid", owner.id, USAGE_PER_DAY, USAGE_DAYS);
      await service.runCheck();

      await setBalance(accountId, BALANCE.amber);
      await service.runCheck();

      expect(await queuedMails()).toEqual([[owner.email, "red"]]);
    });
  });

  describe("the page of accounts", () => {
    it("with a page size of 2, four accounts in four timezones: each gets its own warning (the scan goes past the first page)", async () => {
      jest.replaceProperty(CREDIT_WARNING_CHECK as { pageSize: number }, "pageSize", 2);
      const amber = await seedPaidUser(BALANCE.amber, "Asia/Jakarta");
      const red = await seedPaidUser(BALANCE.red, "UTC");
      const none = await seedPaidUser("100", "America/New_York");
      const floor = await seedPaidUser(BALANCE.amber, "Europe/London");
      await setBalance(floor.accountId, "4.5");

      await service.runCheck();

      expect((await queuedMails()).sort()).toEqual(
        [[amber.owner.email, "amber"], [red.owner.email, "red"], [floor.owner.email, "red"], [floor.owner.email, "floor"]].sort(),
      );
      expect(await prisma.creditWarning.count({ where: { accountId: none.accountId } })).toBe(0);
    });

    it("floor by due reminders: 6 credits (above the floor 5) and one due reminder needing perRunCreditCap 7; another user's reminder does not count", async () => {
      const owner = await createUser(prisma);
      const accountId = await seedAccount(prisma, { userId: owner.id, wallet: "paid" });
      await setBalance(accountId, "6");
      await addEntry(accountId, "paid", "top_up", owner.id, new Date(Date.now() - 10 * DAY_MS));
      // 15 credits at 2 a day: amber; 15 is enough for its own two due reminders (2 x 7), not for three.
      const other = await seedPaidUser("15");
      await addReminder(await seedRoom(other.owner.id), "another user's", 1);
      await addReminder(await seedRoom(other.owner.id), "another user's second", 2);

      await service.runCheck();
      const actualWithoutReminder = await queuedMails();
      await addReminder(await seedRoom(owner.id), "daily report", 1);
      await service.runCheck();

      expect(actualWithoutReminder).toEqual([[other.owner.email, "amber"]]);
      expect(await queuedMails()).toEqual([[other.owner.email, "amber"], [owner.email, "floor"]]);
    });
  });

  describe("AC2: two check runs at the same time (two API containers)", () => {
    /**
     * A second, separate service on its own Prisma client (its own connection pool), whose page read hands back its rows
     * only once `callers` page reads have finished (or RACE_HOLD_MS has passed), so both runs see no warning queued
     * before either records one.
     */
    const createRacingServices = (callers: number): { services: CreditWarningService[]; close: () => Promise<void> } => {
      let finished = 0;
      let releaseAll!: () => void;
      const allFinished = new Promise<void>((resolve) => (releaseAll = resolve));
      const clients = Array.from({ length: callers }, () => PrismaService.create());
      const services = clients.map((client) => {
        const repository = new CreditWarningRepository(client);
        const heldRepository = new Proxy(repository, {
          get: (target, key) =>
            key === "findAccountsToCheck"
              ? async (...args: Parameters<CreditWarningRepository["findAccountsToCheck"]>) => {
                  const rows = await target.findAccountsToCheck(...args);
                  finished += 1;
                  if (finished === callers) releaseAll();
                  await Promise.race([allFinished, new Promise((resolve) => setTimeout(resolve, RACE_HOLD_MS))]);
                  return rows;
                }
              : Reflect.get(target, key),
        });
        return new CreditWarningService(
          moduleRef.get(PlatformSettingsService),
          heldRepository,
          new CreditLedgerEntryRepository(client),
          new ReminderRepository(client),
          new TransactionService(client),
        );
      });
      return { services, close: async () => void (await Promise.all(clients.map((client) => client.$disconnect()))) };
    };

    it("both runs read before either writes: exactly one warning row and one mail per level and cycle", async () => {
      const { owner } = await seedPaidUser(BALANCE.redBelowFloor);
      const racing = createRacingServices(2);

      const actualQueued = await Promise.all(racing.services.map((racingService) => racingService.runCheck())).finally(racing.close);

      expect(actualQueued.reduce((sum, queued) => sum + queued, 0)).toBe(2);
      expect((await queuedMails()).sort()).toEqual([[owner.email, "floor"], [owner.email, "red"]]);
      expect((await prisma.creditWarning.findMany()).map((warning) => warning.level).sort()).toEqual(["floor", "red"]);
    });
  });

  describe("AC3 and the free allowance: no warning without paid credit", () => {
    it("a free user (weekly_free low, paid wallet spent to 0 after an earlier top_up): no warning row, no mail", async () => {
      const owner = await createUser(prisma);
      const weeklyFree = await seedAccount(prisma, { userId: owner.id, wallet: "weekly_free" });
      await setBalance(weeklyFree, "0.5");
      await spendOnDays(weeklyFree, "weekly_free", owner.id, USAGE_PER_DAY, USAGE_DAYS);
      const paid = await seedAccount(prisma, { userId: owner.id, wallet: "paid" });
      await setBalance(paid, "0");
      await addEntry(paid, "paid", "top_up", owner.id, new Date(Date.now() - 10 * DAY_MS));

      await service.runCheck();

      expect(await prisma.creditWarning.count()).toBe(0);
      expect(await queuedMails()).toEqual([]);
    });

    it("a weekly_free wallet is never checked, even one that has a purchase-type entry", async () => {
      const owner = await createUser(prisma);
      const weeklyFree = await seedAccount(prisma, { userId: owner.id, wallet: "weekly_free" });
      await setBalance(weeklyFree, "1");
      await addEntry(weeklyFree, "weekly_free", "top_up", owner.id, new Date(Date.now() - 10 * DAY_MS));
      await spendOnDays(weeklyFree, "weekly_free", owner.id, USAGE_PER_DAY, USAGE_DAYS);

      await service.runCheck();

      expect(await queuedMails()).toEqual([]);
    });

    it("paid credits but no top_up or plan_grant entry (a bonus only): no cycle, no mail", async () => {
      const owner = await createUser(prisma);
      const paid = await seedAccount(prisma, { userId: owner.id, wallet: "paid" });
      await setBalance(paid, BALANCE.redBelowFloor);
      await addEntry(paid, "paid", "bonus", owner.id, new Date(Date.now() - 10 * DAY_MS));
      await spendOnDays(paid, "paid", owner.id, USAGE_PER_DAY, USAGE_DAYS);

      await service.runCheck();

      expect(await queuedMails()).toEqual([]);
    });
  });

  describe("recipient: the account owner only", () => {
    it("a company pool at red and below the floor gets no mail; a user's own account mails that user only", async () => {
      const { owner } = await seedPaidUser(BALANCE.redBelowFloor);
      const billingAdmin = await createUser(prisma);
      const pool = await seedAccount(prisma, { companyId: "company-1", wallet: "paid" });
      await setBalance(pool, BALANCE.redBelowFloor);
      await addEntry(pool, "paid", "top_up", billingAdmin.id, new Date(Date.now() - 10 * DAY_MS));
      await spendOnDays(pool, "paid", billingAdmin.id, USAGE_PER_DAY, USAGE_DAYS);

      await service.runCheck();

      expect((await queuedMails()).sort()).toEqual([[owner.email, "floor"], [owner.email, "red"]]);
      expect(await prisma.creditWarning.count({ where: { accountId: pool } })).toBe(0);
    });
  });

  describe("AC4: a meter setting not set skips the whole check", () => {
    it.each(CREDIT_METER_SETTING_NAMES)("%s deleted: nothing is recorded or queued, and the log names it", async (name) => {
      await seedPaidUser(BALANCE.redBelowFloor);
      await prisma.platformSetting.delete({ where: { name } });
      const log = captureLogLines();

      const actualQueued = await service.runCheck();

      expect(actualQueued).toBe(0);
      expect(await prisma.creditWarning.count()).toBe(0);
      expect(await queuedMails()).toEqual([]);
      expect(log.lines.filter((line) => line.includes("Run-out warning check skipped"))).toEqual([
        expect.stringContaining(`platform settings not set: ${name}`),
      ]);
    });
  });

  describe("AC7 (D360): the red mail lists at most RED_STATE_REMINDER_LIMIT scheduled runs", () => {
    it("more due runs before the run-out than the limit: the payload and the built mail list exactly the limit, soonest first", async () => {
      const { owner } = await seedPaidUser(BALANCE.red);
      const room = await seedRoom(owner.id);
      const inputCount = RED_STATE_REMINDER_LIMIT + 2;
      // Created latest first, so a list in creation order would not be soonest first; all due within 1 day, before the run-out.
      for (let i = inputCount; i >= 1; i--) await addReminder(room, `run ${i}`, i / (inputCount + 1));
      await addReminder(room, "after the run-out", 4);

      await service.runCheck();

      const job = await prisma.emailJob.findFirstOrThrow();
      const payload = job.payload as unknown as CreditWarningEmailPayload;
      const expectedDescriptions = Array.from({ length: RED_STATE_REMINDER_LIMIT }, (_unused, i) => `run ${i + 1}`);
      expect(payload.level).toBe("red");
      expect(payload.reminders.map((run) => run.description)).toEqual(expectedDescriptions);
      const actualMail = buildCreditWarningEmail(payload);
      expect(actualMail.text.split("\n").filter((line) => line.startsWith("- run "))).toEqual(expectedDescriptions.map((description) => expect.stringContaining(`- ${description} (`)));
      expect(actualMail.html.match(/<li>/g)).toHaveLength(RED_STATE_REMINDER_LIMIT);
    });
  });
});
