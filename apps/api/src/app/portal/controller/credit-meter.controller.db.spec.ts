import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { asSessionUser } from "../../../../test/as-session-user";
import { captureLogLines } from "../../../../test/capture-log-lines";
import { createAgent, createUser } from "../../../../test/factories";
import { seedAccount, seedCall } from "../../../../test/usage-seed";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { CreditMeterService } from "../service/credit-meter.service";
import { formatRunOutLabel } from "../utils/format-run-out-label";
import { CreditMeterController } from "./credit-meter.controller";

// RNX-30-A AC1 (DB part), AC2 and AC3: GET /chat/portal/credit-meter on the test database, through the real controller,
// service, repositories and PlatformSettingsService. The session is the mocked Better Auth one (asSessionUser).
// Every threshold uses a NON-default value (seeded: amber 7, red 2, floor 1, perRunCreditCap 10, projectionMinSpendCredits
// 1, projectionMaxDays 365), so a threshold hard-coded to its seeded value turns a test red (D83).
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const SETTINGS = {
  runOutAmberDays: 10,
  runOutRedDays: 3,
  runOutFloorCredits: 5,
  perRunCreditCap: 7,
  projectionMinSpendCredits: 2,
  projectionMaxDays: 30,
} as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const URL = "/chat/portal/credit-meter";

type MeterUser = { id: string; email: string };
type Wallet = "paid" | "weekly_free";

describe("GET /chat/portal/credit-meter (RNX-30-A, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [CreditMeterController],
      providers: [CreditMeterService, PlatformSettingsService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.platformSetting.createMany({ data: Object.entries(SETTINGS).map(([name, value]) => ({ name, value })) });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  const getMeter = (user: MeterUser, query = "") => app.inject({ method: "GET", url: `${URL}${query}`, headers: asSessionUser(user) });

  /** A wallet of this user with this balance and held amount; returns its account id. */
  const addWallet = async (userId: string, wallet: Wallet, balance: string, held = "0"): Promise<string> => {
    const accountId = await seedAccount(prisma, { userId, wallet });
    await prisma.creditAccount.update({ where: { id: accountId }, data: { balance, held } });
    return accountId;
  };

  /** One usage entry of `credits` on this account at `at`. */
  const spend = (accountId: string, wallet: Wallet, userId: string, credits: string, at: Date) =>
    seedCall(prisma, {
      accountId,
      wallet,
      memberUserId: userId,
      credits,
      at: at.toISOString(),
      providerId: null,
      model: "test-model",
      tier: "standard",
      tokens: { new: 1, cached: 0, out: 1, reasoning: null },
      cost: { lowUsd: null, highUsd: null, lowIdr: null, highIdr: null },
    });

  /** `credits` spent on each of the days `daysAgo` (now minus that many days). */
  const spendOnDays = async (accountId: string, wallet: Wallet, userId: string, credits: string, daysAgo: readonly number[]) => {
    for (const days of daysAgo) await spend(accountId, wallet, userId, credits, new Date(Date.now() - days * DAY_MS));
  };

  /** A channel, agent and room of this user, for its reminders. */
  const seedRoom = async (userId: string) => {
    const agent = await createAgent(prisma, { userId });
    const channel = await prisma.channel.create({ data: { userId, name: "Room" } });
    const room = await prisma.channelChatRoom.create({ data: { channelId: channel.id } });
    return { userId, agentId: agent.id, channelId: channel.id, chatRoomId: room.id };
  };

  const addReminder = (
    room: Awaited<ReturnType<typeof seedRoom>>,
    data: { description: string; inDays: number; status?: "ACTIVE" | "PAUSED"; deletedAt?: Date },
  ) =>
    prisma.reminder.create({
      data: {
        ...room,
        prompt: data.description,
        description: data.description,
        cronExpression: "0 8 * * *",
        nextRunAt: new Date(Date.now() + data.inDays * DAY_MS),
        status: data.status,
        deletedAt: data.deletedAt,
      },
    });

  describe("AC1 (DB part): the projection reads the paid wallet's usage only, days counted in the profile timezone", () => {
    it("7 paid credits on 4 days of the last 7 (1 a day), 8 available: run-out in 8 days, amber at runOutAmberDays 10; weekly_free and older usage not counted", async () => {
      const user = await createUser(prisma, { timezone: "Asia/Jakarta" });
      const paid = await addWallet(user.id, "paid", "9", "1");
      const weeklyFree = await addWallet(user.id, "weekly_free", "2", "0.5");
      await spendOnDays(paid, "paid", user.id, "1.75", [1, 2, 3, 4]);
      await spendOnDays(weeklyFree, "weekly_free", user.id, "20", [1, 2, 3, 4, 5]);
      await spend(paid, "paid", user.id, "100", new Date(Date.now() - 7 * DAY_MS - 60_000));
      const before = Date.now();

      const actual = await getMeter(user);

      const after = Date.now();
      expect(actual.statusCode).toBe(200);
      const body = actual.json();
      expect(body).toMatchObject({ paidAvailable: "8", weeklyFreeAvailable: "1.5", level: "amber", belowFloor: false, dueReminders: [] });
      expect(body.projection).toMatchObject({ status: "date", timeZone: "Asia/Jakarta" });
      const actualRunOutAt = new Date(body.projection.runOutAt).getTime();
      expect(actualRunOutAt).toBeGreaterThanOrEqual(before + 8 * DAY_MS);
      expect(actualRunOutAt).toBeLessThanOrEqual(after + 8 * DAY_MS);
      expect(body.projection.runOutLabel).toBe(formatRunOutLabel(new Date(actualRunOutAt), "Asia/Jakarta"));
      expect(body.projection.runOutLabel).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:00$/);
    });

    it("weekly_free usage only: not enough use (the free allowance gets no projection)", async () => {
      const user = await createUser(prisma);
      await addWallet(user.id, "paid", "8");
      const weeklyFree = await addWallet(user.id, "weekly_free", "2");
      await spendOnDays(weeklyFree, "weekly_free", user.id, "5", [1, 2, 3, 4, 5]);

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ projection: { status: "not_enough_use" }, level: "none", weeklyFreeAvailable: "2" });
    });

    it("3 UTC days that are 2 days in Asia/Jakarta: projected for a UTC profile, not enough use for a Jakarta profile", async () => {
      const startOfToday = new Date(new Date().setUTCHours(0, 0, 0, 0)).getTime();
      // 10:00Z three days ago (17:00 WIB that day); 18:00Z two days ago (01:00 WIB the next day); 10:00Z yesterday
      // (17:00 WIB yesterday): three UTC dates, two Jakarta dates.
      const times = [startOfToday - 3 * DAY_MS + 10 * 3_600_000, startOfToday - 2 * DAY_MS + 18 * 3_600_000, startOfToday - DAY_MS + 10 * 3_600_000];
      const seedUser = async (timezone: string) => {
        const user = await createUser(prisma, { timezone });
        const paid = await addWallet(user.id, "paid", "5");
        for (const at of times) await spend(paid, "paid", user.id, "1", new Date(at));
        return user;
      };
      const utcUser = await seedUser("UTC");
      const jakartaUser = await seedUser("Asia/Jakarta");

      const actualUtc = await getMeter(utcUser);
      const actualJakarta = await getMeter(jakartaUser);

      expect(actualUtc.json().projection).toMatchObject({ status: "date", timeZone: "UTC" });
      expect(actualJakarta.json().projection).toEqual({ status: "not_enough_use" });
    });

    it("a stored time zone the database would reject: the meter answers in UTC instead of failing", async () => {
      const startOfToday = new Date(new Date().setUTCHours(0, 0, 0, 0)).getTime();
      const user = await createUser(prisma, { timezone: "Not/AZone" });
      const paid = await addWallet(user.id, "paid", "5");
      for (const daysAgo of [1, 2, 3]) await spend(paid, "paid", user.id, "1", new Date(startOfToday - daysAgo * DAY_MS + 10 * 3_600_000));

      const actual = await getMeter(user);

      expect(actual.statusCode).toBe(200);
      expect(actual.json().projection).toMatchObject({ status: "date", timeZone: "UTC" });
    });

    it("a run-out beyond projectionMaxDays (30): more than a year, level none", async () => {
      const user = await createUser(prisma);
      const paid = await addWallet(user.id, "paid", "40");
      await spendOnDays(paid, "paid", user.id, "2.333333", [1, 2, 3]);

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ projection: { status: "more_than_a_year" }, level: "none", belowFloor: false });
    });
  });

  describe("AC2: the level, the floor flag and the red-state reminders follow the settings", () => {
    it("run-out in 2 days: red at runOutRedDays 3; lists only the user's active, live reminders due before the run-out, earliest first", async () => {
      const user = await createUser(prisma);
      const other = await createUser(prisma);
      const paid = await addWallet(user.id, "paid", "2");
      await spendOnDays(paid, "paid", user.id, "2.333333", [1, 2, 3]);
      const room = await seedRoom(user.id);
      const otherRoom = await seedRoom(other.id);
      const second = await addReminder(room, { description: "second", inDays: 1.5 });
      const first = await addReminder(room, { description: "first", inDays: 1 });
      await addReminder(room, { description: "paused", inDays: 1, status: "PAUSED" });
      await addReminder(room, { description: "deleted", inDays: 1, deletedAt: new Date() });
      await addReminder(room, { description: "after the run-out", inDays: 2.5 });
      await addReminder(otherRoom, { description: "another user's", inDays: 1 });

      const actual = await getMeter(user);

      expect(actual.statusCode).toBe(200);
      expect(actual.json()).toMatchObject({ level: "red", belowFloor: true, projection: { status: "date" } });
      expect(actual.json().dueReminders).toEqual([
        { id: first.id, description: "first", nextRunAt: first.nextRunAt.toISOString() },
        { id: second.id, description: "second", nextRunAt: second.nextRunAt.toISOString() },
      ]);
    });

    it("run-out in 8 days: amber at runOutAmberDays 10 (none with the seeded 7), no reminder list outside red", async () => {
      const user = await createUser(prisma);
      const paid = await addWallet(user.id, "paid", "8");
      await spendOnDays(paid, "paid", user.id, "2.333333", [1, 2, 3]);
      await addReminder(await seedRoom(user.id), { description: "soon", inDays: 1 });

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ level: "amber", dueReminders: [] });
    });

    it("run-out in 2.5 days: red at runOutRedDays 3 (amber with the seeded 2)", async () => {
      const user = await createUser(prisma);
      const paid = await addWallet(user.id, "paid", "10.5");
      await spendOnDays(paid, "paid", user.id, "9.8", [1, 2, 3]);

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ level: "red" });
    });

    it("run-out in 11 days: none", async () => {
      const user = await createUser(prisma);
      const paid = await addWallet(user.id, "paid", "11");
      await spendOnDays(paid, "paid", user.id, "2.333333", [1, 2, 3]);

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ level: "none", projection: { status: "date" } });
    });

    it("below runOutFloorCredits (5; clear with the seeded 1) and no projection: the floor flag is set whatever the projection", async () => {
      const user = await createUser(prisma);
      await addWallet(user.id, "paid", "4.999999");

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ projection: { status: "not_enough_use" }, level: "none", belowFloor: true });
    });

    it("at runOutFloorCredits (5) with no due reminder: no floor flag", async () => {
      const user = await createUser(prisma);
      await addWallet(user.id, "paid", "5");

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ belowFloor: false });
    });

    it("due reminders (A'): only the active one within the next runOutAmberDays (10) days counts, each needs perRunCreditCap (7)", async () => {
      const user = await createUser(prisma);
      const other = await createUser(prisma);
      const room = await seedRoom(user.id);
      await addReminder(room, { description: "inside the window (outside the seeded 7)", inDays: 9 });
      await addReminder(room, { description: "outside the window", inDays: 11 });
      await addReminder(room, { description: "paused inside", inDays: 1, status: "PAUSED" });
      await addReminder(room, { description: "deleted inside", inDays: 1, deletedAt: new Date() });
      await addReminder(await seedRoom(other.id), { description: "another user's", inDays: 1 });
      const paid = await addWallet(user.id, "paid", "6");

      const actualOneDue = await getMeter(user);
      await prisma.creditAccount.update({ where: { id: paid }, data: { balance: "8" } });
      const actualCovered = await getMeter(user);

      // 6 < 7 x 1 due reminder: flagged (6 is above the floor 5). 8 >= 7 x 1: clear; it would be flagged if a second
      // reminder (outside, paused, deleted or another user's) counted (8 < 14).
      expect(actualOneDue.json()).toMatchObject({ projection: { status: "not_enough_use" }, belowFloor: true });
      expect(actualCovered.json()).toMatchObject({ belowFloor: false });
    });
  });

  describe("settings not set", () => {
    it("no meter setting: not enough use, level none, no floor flag, and the missing names logged once", async () => {
      await prisma.platformSetting.deleteMany();
      const user = await createUser(prisma);
      const paid = await addWallet(user.id, "paid", "1");
      await spendOnDays(paid, "paid", user.id, "2.333333", [1, 2, 3]);
      await addReminder(await seedRoom(user.id), { description: "soon", inDays: 1 });
      const log = captureLogLines();

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ projection: { status: "not_enough_use" }, level: "none", belowFloor: false });
      const actualLines = log.lines.filter((line) => line.includes("Credit meter"));
      expect(actualLines).toHaveLength(1);
      expect(actualLines[0]).toContain(
        "projectionMinSpendCredits, projectionMaxDays, runOutAmberDays, runOutRedDays, runOutFloorCredits, perRunCreditCap",
      );
    });

    it("only projectionMaxDays not set: not enough use, and only that name is logged", async () => {
      await prisma.platformSetting.delete({ where: { name: "projectionMaxDays" } });
      const user = await createUser(prisma);
      const paid = await addWallet(user.id, "paid", "100");
      await spendOnDays(paid, "paid", user.id, "2.333333", [1, 2, 3]);
      const log = captureLogLines();

      const actual = await getMeter(user);

      expect(actual.json()).toMatchObject({ projection: { status: "not_enough_use" } });
      expect(log.lines.filter((line) => line.includes("Credit meter"))).toEqual([
        expect.stringContaining("platform settings not set, their checks are skipped: projectionMaxDays"),
      ]);
    });
  });

  describe("AC3: only the caller's own meter", () => {
    it("a query naming another user or company is ignored: the answer is the caller's", async () => {
      const caller = await createUser(prisma);
      const other = await createUser(prisma);
      await addWallet(caller.id, "paid", "6");
      const otherPaid = await addWallet(other.id, "paid", "3");
      await addWallet(other.id, "weekly_free", "2");
      await spendOnDays(otherPaid, "paid", other.id, "2.333333", [1, 2, 3]);

      const actualPlain = await getMeter(caller);
      const actualWithParams = await getMeter(caller, `?userId=${other.id}&user=${other.id}&companyId=${other.id}&accountId=${otherPaid}`);

      expect(actualWithParams.statusCode).toBe(200);
      expect(actualWithParams.json()).toEqual(actualPlain.json());
      expect(actualWithParams.json()).toEqual({
        paidAvailable: "6",
        weeklyFreeAvailable: "0",
        projection: { status: "not_enough_use" },
        level: "none",
        belowFloor: false,
        dueReminders: [],
      });
    });

    it("another user's id in the path is not a route", async () => {
      const caller = await createUser(prisma);
      const other = await createUser(prisma);

      const actual = await app.inject({ method: "GET", url: `${URL}/${other.id}`, headers: asSessionUser(caller) });

      expect(actual.statusCode).toBe(404);
    });

    it("no session: 401", async () => {
      const actual = await app.inject({ method: "GET", url: URL });

      expect(actual.statusCode).toBe(401);
    });

    it("an anonymous portal session (X-Portal-Session) is not a session: 401", async () => {
      const actual = await app.inject({ method: "GET", url: URL, headers: { "x-portal-session": "00000000-0000-4000-8000-000000000000" } });

      expect(actual.statusCode).toBe(401);
    });
  });
});
