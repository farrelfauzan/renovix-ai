import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { PortalTierService, jakartaDay } from "./portal-tier.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";

// ConfigService falls back to process.env: these tests must not depend on the shell.
for (const key of ["IP_HASH_SECRET", "ANON_DAILY_IP_CAP", "ANON_DAILY_GLOBAL_CAP", "CLIENT_IP_HEADER"]) {
  delete process.env[key];
}

describe("RX-10: free-tier reservation (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({}));
  });
  beforeEach(() => resetDatabase(prisma));
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => moduleRef?.close());

  const tierService = (caps: { ip?: number; global?: number } = {}) =>
    new PortalTierService(
      prisma,
      new ConfigService({
        IP_HASH_SECRET: "rx10-test-secret",
        ANON_DAILY_IP_CAP: String(caps.ip ?? 60),
        ANON_DAILY_GLOBAL_CAP: String(caps.global ?? 2000),
      }),
    );

  /** A fresh session row (bypasses the 3-sessions-per-IP rule). */
  const newSession = async () => {
    const sessionToken = randomUUID();
    await prisma.portalSession.create({ data: { sessionToken } });
    return sessionToken;
  };

  const counter = async (bucket: string) =>
    (
      await prisma.anonymousUsageCounter.findUnique({
        where: {
          bucket_day: { bucket, day: new Date(`${jakartaDay()}T00:00:00Z`) },
        },
      })
    )?.count;

  it("rotating the session UUID from one IP does not reset the per-IP limit", async () => {
    const tier = tierService({ ip: 5 });
    const ip = "198.51.100.10";
    const results: string[] = [];

    for (let i = 0; i < 3; i++) {
      const session = await newSession();
      results.push(await tier.reserveFreeRequest(session, ip));
      results.push(await tier.reserveFreeRequest(session, ip));
    }

    expect(results).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
      "free_limit_reached",
    ]);
    expect(await counter(`ip:${tier.hashIp(ip)}`)).toBe(5);
    // Another IP is not affected
    expect(
      await tier.reserveFreeRequest(await newSession(), "198.51.100.11"),
    ).toBe("ok");
  });

  it("the session cap is still 20 a day", async () => {
    const tier = tierService();
    const session = await newSession();

    for (let i = 0; i < 20; i++) {
      expect(await tier.reserveFreeRequest(session, "198.51.100.20")).toBe(
        "ok",
      );
    }

    expect(await tier.reserveFreeRequest(session, "198.51.100.20")).toBe(
      "free_limit_reached",
    );
    expect(
      (
        await prisma.portalSession.findUnique({
          where: { sessionToken: session },
        })
      )?.requestCount,
    ).toBe(20);
  });

  it("the global cap answers free_capacity_reached and rolls back the session and IP counts", async () => {
    const tier = tierService({ global: 3 });
    for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.3"]) {
      expect(await tier.reserveFreeRequest(await newSession(), ip)).toBe("ok");
    }
    const session = await newSession();

    expect(await tier.reserveFreeRequest(session, "192.0.2.4")).toBe(
      "free_capacity_reached",
    );

    expect(await counter("global")).toBe(3);
    expect(await counter(`ip:${tier.hashIp("192.0.2.4")}`)).toBeUndefined();
    expect(
      (
        await prisma.portalSession.findUnique({
          where: { sessionToken: session },
        })
      )?.requestCount,
    ).toBe(0);
  });

  it("parallel reservations never exceed the per-IP cap", async () => {
    const tier = tierService({ ip: 3 });
    const sessions = await Promise.all(Array.from({ length: 10 }, newSession));

    const results = await Promise.all(
      sessions.map((s) => tier.reserveFreeRequest(s, "203.0.113.50")),
    );

    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    expect(await counter(`ip:${tier.hashIp("203.0.113.50")}`)).toBe(3);
    expect(await counter("global")).toBe(3);
    const counted = await prisma.portalSession.aggregate({
      _sum: { requestCount: true },
    });
    expect(counted._sum.requestCount).toBe(3);
  });

  it("parallel reservations never exceed the global cap; rejected ones leave no IP or session count", async () => {
    const tier = tierService({ global: 4 });
    const ips = Array.from({ length: 10 }, (_, i) => `203.0.113.${i + 1}`);
    const sessions = await Promise.all(ips.map(newSession));

    const results = await Promise.all(
      sessions.map((s, i) => tier.reserveFreeRequest(s, ips[i])),
    );

    expect(results.filter((r) => r === "ok")).toHaveLength(4);
    expect(results.filter((r) => r === "free_capacity_reached")).toHaveLength(
      6,
    );
    expect(await counter("global")).toBe(4);
    expect(
      await prisma.anonymousUsageCounter.count({
        where: { bucket: { startsWith: "ip:" } },
      }),
    ).toBe(4);
    const counted = await prisma.portalSession.aggregate({
      _sum: { requestCount: true },
    });
    expect(counted._sum.requestCount).toBe(4);
  });

  it("stores and logs no raw IP", async () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const tier = tierService({ ip: 1 });
    const ip = "198.51.100.77";
    const session = await tier.getOrCreateSession(randomUUID(), ip);

    expect(await tier.reserveFreeRequest(session!.sessionToken, ip)).toBe("ok");
    expect(await tier.reserveFreeRequest(session!.sessionToken, ip)).toBe(
      "free_limit_reached",
    );

    const stored = await prisma.portalSession.findUniqueOrThrow({
      where: { id: session!.id },
    });
    expect(stored.ipAddress).toBe(tier.hashIp(ip));
    const buckets = await prisma.anonymousUsageCounter.findMany();
    expect(buckets.map((b) => b.bucket).sort()).toEqual([
      "global",
      `ip:${tier.hashIp(ip)}`,
    ]);
    expect(JSON.stringify([stored, buckets])).not.toContain(ip);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(tier.hashIp(ip).slice(0, 8)),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ip);
  });

  it("limits new sessions per hashed IP (MAX_SESSIONS_PER_IP)", async () => {
    const tier = tierService();
    for (let i = 0; i < 3; i++) {
      expect(
        await tier.getOrCreateSession(randomUUID(), "198.51.100.99"),
      ).not.toBeNull();
    }

    expect(
      await tier.getOrCreateSession(randomUUID(), "198.51.100.99"),
    ).toBeNull();
  });

  it("invalid cap values fall back to the defaults with a warning", async () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const tier = new PortalTierService(
      prisma,
      new ConfigService({
        IP_HASH_SECRET: "rx10-test-secret",
        ANON_DAILY_IP_CAP: "-3",
        ANON_DAILY_GLOBAL_CAP: "lots",
      }),
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ANON_DAILY_IP_CAP"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("ANON_DAILY_GLOBAL_CAP"),
    );
    expect(
      await tier.reserveFreeRequest(await newSession(), "198.51.100.5"),
    ).toBe("ok");
  });

  it("requires IP_HASH_SECRET", () => {
    expect(() => new PortalTierService(prisma, new ConfigService({}))).toThrow(
      /IP_HASH_SECRET/,
    );
  });

  it("the cleanup removes counters older than 7 days", async () => {
    const tier = tierService();
    const daysAgo = (n: number) =>
      new Date(
        `${jakartaDay(new Date(Date.now() - n * 86_400_000))}T00:00:00Z`,
      );
    await prisma.anonymousUsageCounter.createMany({
      data: [
        { bucket: "global", day: daysAgo(8), count: 1 },
        { bucket: "global", day: daysAgo(7), count: 1 },
        { bucket: "global", day: daysAgo(0), count: 1 },
      ],
    });

    await tier.cleanupAnonymousCounters();

    const left = await prisma.anonymousUsageCounter.findMany({
      orderBy: { day: "asc" },
    });
    expect(left.map((r) => r.day)).toEqual([daysAgo(7), daysAgo(0)]);
  });
});
