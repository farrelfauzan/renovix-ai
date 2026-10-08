import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { createHmac } from "node:crypto";
import type { Prisma } from "@generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service";

const FREE_REQUEST_LIMIT = 20;
const MAX_SESSIONS_PER_IP = 3;
const DEFAULT_DAILY_IP_CAP = 60;
const DEFAULT_DAILY_GLOBAL_CAP = 2000;
const COUNTER_RETENTION_DAYS = 7;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta is UTC+7, no DST

/** The free-tier day of `now` in Asia/Jakarta, as "YYYY-MM-DD". */
export function jakartaDay(now: Date = new Date()): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 WIB of the free-tier day that contains `now`. */
export function startOfJakartaDay(now: Date = new Date()): Date {
  return new Date(`${jakartaDay(now)}T00:00:00+07:00`);
}

interface ClientIpRequest {
  headers: Record<string, string | string[] | undefined>;
  raw?: { socket?: { remoteAddress?: string } };
  socket?: { remoteAddress?: string };
}

const clientIpLogger = new Logger("clientIp");
let warnedMissingIpHeader = false;

/**
 * The client IP for the free-tier caps. With CLIENT_IP_HEADER set, only that
 * header counts (a trusted proxy in front of the API must set it and overwrite
 * any client-sent copy); without it (local, tests) the socket address. Never
 * X-Forwarded-For or request.ip.
 */
export function clientIp(req: ClientIpRequest): string {
  const headerName = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (headerName) {
    const value = req.headers[headerName];
    const ip = (Array.isArray(value) ? value[0] : value)?.split(",")[0].trim();
    if (ip) return ip;
    if (!warnedMissingIpHeader) {
      warnedMissingIpHeader = true;
      clientIpLogger.warn(
        `Header ${headerName} missing: requests without it share the "unknown" IP bucket`,
      );
    }
    return "unknown";
  }
  return (
    req.raw?.socket?.remoteAddress ?? req.socket?.remoteAddress ?? "unknown"
  );
}

export type FreeReservation =
  "ok" | "free_limit_reached" | "free_capacity_reached";

class CapReached extends Error {
  constructor(readonly cap: "session" | "ip" | "global") {
    super(cap);
  }
}

export interface TierUsage {
  tier: "free" | "paid";
  used?: number;
  limit?: number;
  remaining?: number;
  balance?: string;
  unlimited?: boolean;
}

@Injectable()
export class PortalTierService {
  private readonly logger = new Logger(PortalTierService.name);
  private readonly ipHashSecret: string;
  private readonly dailyIpCap: number;
  private readonly dailyGlobalCap: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.ipHashSecret = config.getOrThrow<string>("IP_HASH_SECRET");
    this.dailyIpCap = this.capFromEnv(
      config,
      "ANON_DAILY_IP_CAP",
      DEFAULT_DAILY_IP_CAP,
    );
    this.dailyGlobalCap = this.capFromEnv(
      config,
      "ANON_DAILY_GLOBAL_CAP",
      DEFAULT_DAILY_GLOBAL_CAP,
    );
  }

  private capFromEnv(
    config: ConfigService,
    key: string,
    fallback: number,
  ): number {
    const raw = config.get<string>(key);
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
    this.logger.warn(`${key} is not a positive integer; using ${fallback}`);
    return fallback;
  }

  /** HMAC-SHA256 of the client IP: raw IPs are never stored. */
  hashIp(ip: string): string {
    return createHmac("sha256", this.ipHashSecret).update(ip).digest("hex");
  }

  async getOrCreateSession(sessionToken: string, ip?: string) {
    const existing = await this.prisma.portalSession.findUnique({
      where: { sessionToken },
    });

    if (existing) {
      // Reset request count if last reset was before today
      if (existing.lastResetAt < startOfJakartaDay()) {
        return this.prisma.portalSession.update({
          where: { sessionToken },
          data: { requestCount: 0, lastResetAt: new Date() },
        });
      }
      return existing;
    }

    const ipAddress = ip ? this.hashIp(ip) : undefined;

    // Check IP-based session limit (only count sessions created in last 24h)
    if (ipAddress) {
      const recentSessions = await this.prisma.portalSession.count({
        where: {
          ipAddress,
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });

      if (recentSessions >= MAX_SESSIONS_PER_IP) {
        return null; // signal that session creation is blocked
      }
    }

    return this.prisma.portalSession.create({
      data: {
        sessionToken,
        ipAddress: ipAddress ?? null,
        lastResetAt: new Date(),
      },
    });
  }

  /**
   * Reserves one free request before the model call: the session, per-IP and
   * global daily counters, in one transaction. If any cap is reached nothing
   * is counted. A reserved request is not refunded if the model call fails.
   */
  async reserveFreeRequest(
    sessionToken: string,
    ip: string,
  ): Promise<FreeReservation> {
    const ipHash = this.hashIp(ip);
    const day = jakartaDay();
    try {
      await this.prisma.$transaction(async (tx) => {
        const session = await tx.$queryRaw<unknown[]>`
          UPDATE "portal_sessions"
          SET "requestCount" = "requestCount" + 1, "lastRequestAt" = now()
          WHERE "sessionToken" = ${sessionToken}
            AND "requestCount" < ${FREE_REQUEST_LIMIT}
          RETURNING "requestCount"`;
        if (session.length === 0) throw new CapReached("session");

        if (!(await this.bump(tx, `ip:${ipHash}`, day, this.dailyIpCap))) {
          throw new CapReached("ip");
        }
        if (!(await this.bump(tx, "global", day, this.dailyGlobalCap))) {
          throw new CapReached("global");
        }
      });
      return "ok";
    } catch (err) {
      if (!(err instanceof CapReached)) throw err;
      this.logger.warn(
        `Free-tier ${err.cap} daily cap reached (ip hash ${ipHash.slice(0, 8)})`,
      );
      return err.cap === "global"
        ? "free_capacity_reached"
        : "free_limit_reached";
    }
  }

  /** Adds one to a daily counter unless it is at `cap`; false when at the cap. */
  private async bump(
    tx: Prisma.TransactionClient,
    bucket: string,
    day: string,
    cap: number,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<unknown[]>`
      INSERT INTO "anonymous_usage_counters" ("bucket", "day", "count")
      VALUES (${bucket}, ${day}::date, 1)
      ON CONFLICT ("bucket", "day") DO UPDATE
      SET "count" = "anonymous_usage_counters"."count" + 1
      WHERE "anonymous_usage_counters"."count" < ${cap}
      RETURNING "count"`;
    return rows.length > 0;
  }

  async getUsage(
    sessionToken: string,
    userBalance?: number,
  ): Promise<TierUsage> {
    if (userBalance !== undefined && userBalance > 0) {
      return {
        tier: "paid",
        balance: userBalance.toFixed(6),
        unlimited: true,
      };
    }

    const session = await this.prisma.portalSession.findUnique({
      where: { sessionToken },
    });

    let used = session?.requestCount ?? 0;

    // Auto-reset if a new day has started
    if (session && session.lastResetAt < startOfJakartaDay()) {
      await this.prisma.portalSession.update({
        where: { sessionToken: session.sessionToken },
        data: { requestCount: 0, lastResetAt: new Date() },
      });
      used = 0;
    }

    return {
      tier: "free",
      used,
      limit: FREE_REQUEST_LIMIT,
      remaining: Math.max(0, FREE_REQUEST_LIMIT - used),
    };
  }

  async linkSessionToUser(sessionToken: string, userId: string): Promise<void> {
    await this.prisma.portalSession.upsert({
      where: { sessionToken },
      update: { userId },
      create: {
        sessionToken,
        userId,
        lastResetAt: new Date(),
      },
    });
  }

  /** Daily at 00:00 WIB: reset all request counts */
  @Cron("0 0 * * *", { timeZone: "Asia/Jakarta" })
  async resetDailyRequestCounts(): Promise<void> {
    const result = await this.prisma.portalSession.updateMany({
      where: {
        lastResetAt: { lt: startOfJakartaDay() },
      },
      data: { requestCount: 0, lastResetAt: new Date() },
    });

    if (result.count > 0) {
      this.logger.log(
        `Reset daily request counts for ${result.count} sessions`,
      );
    }
  }

  /** Daily: remove free-tier counters older than 7 days */
  @Cron("0 1 * * *", { timeZone: "Asia/Jakarta" })
  async cleanupAnonymousCounters(): Promise<void> {
    const cutoff = jakartaDay(
      new Date(Date.now() - COUNTER_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
    await this.prisma.anonymousUsageCounter.deleteMany({
      where: { day: { lt: new Date(`${cutoff}T00:00:00Z`) } },
    });
  }

  /** Weekly cleanup: remove sessions inactive for 30+ days */
  @Cron("0 1 * * 0")
  async cleanupStaleSessions(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.portalSession.deleteMany({
      where: {
        lastRequestAt: { lt: thirtyDaysAgo },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} stale portal sessions`);
    }
  }
}
