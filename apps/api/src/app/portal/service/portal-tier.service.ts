import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { createHmac } from "node:crypto";
import { TransactionService } from "../../prisma/transaction.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { AnonymousUsageCounterRepository } from "../repository/anonymous-usage-counter.repository";
import { PortalSessionRepository } from "../repository/portal-session.repository";

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
    private readonly sessions: PortalSessionRepository,
    private readonly counters: AnonymousUsageCounterRepository,
    private readonly transactions: TransactionService,
    config: ConfigService,
    @Optional() private readonly settings?: PlatformSettingsService,
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

  private async setting(name: "anonymousRequestsPerSession" | "anonymousSessionsPerIp", fallback: number): Promise<number> {
    return (await this.settings?.getSetting(name)) ?? fallback;
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
    const existing = await this.sessions.findSessionByToken(sessionToken);

    if (existing) {
      // Reset request count if last reset was before today
      if (existing.lastResetAt < startOfJakartaDay()) {
        return this.sessions.resetRequestCount(sessionToken);
      }
      return existing;
    }

    const ipAddress = ip ? this.hashIp(ip) : undefined;

    // Check IP-based session limit (only count sessions created in last 24h)
    if (ipAddress) {
      const recentSessions = await this.sessions.countSessionsCreatedSince(
        ipAddress,
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

       if (recentSessions >= (await this.setting("anonymousSessionsPerIp", 3))) {
        return null; // signal that session creation is blocked
      }
    }

    return this.sessions.createSession(sessionToken, ipAddress ?? null);
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
    const freeRequestLimit = await this.setting("anonymousRequestsPerSession", 20);
    try {
      await this.transactions.run(async (tx) => {
        if (
          !(await this.sessions.incrementFreeRequestCount(
            sessionToken,
            freeRequestLimit,
            tx,
          ))
        ) {
          throw new CapReached("session");
        }
        if (
          !(await this.counters.incrementCounterBelowCap(
            `ip:${ipHash}`,
            day,
            this.dailyIpCap,
            tx,
          ))
        ) {
          throw new CapReached("ip");
        }
        if (
          !(await this.counters.incrementCounterBelowCap(
            "global",
            day,
            this.dailyGlobalCap,
            tx,
          ))
        ) {
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

    const session = await this.sessions.findSessionByToken(sessionToken);

    let used = session?.requestCount ?? 0;

    // Auto-reset if a new day has started
    if (session && session.lastResetAt < startOfJakartaDay()) {
      await this.sessions.resetRequestCount(session.sessionToken);
      used = 0;
    }

    return {
      tier: "free",
      used,
        limit: await this.setting("anonymousRequestsPerSession", 20),
        remaining: Math.max(0, (await this.setting("anonymousRequestsPerSession", 20)) - used),
    };
  }

  async linkSessionToUser(sessionToken: string, userId: string): Promise<void> {
    await this.sessions.linkSessionToUser(sessionToken, userId);
  }

  /** Daily at 00:00 WIB: reset all request counts */
  @Cron("0 0 * * *", { timeZone: "Asia/Jakarta" })
  async resetDailyRequestCounts(): Promise<void> {
    const result = await this.sessions.resetRequestCountsResetBefore(
      startOfJakartaDay(),
    );

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
    await this.counters.deleteCountersBefore(new Date(`${cutoff}T00:00:00Z`));
  }

  /** Weekly cleanup: remove sessions inactive for 30+ days */
  @Cron("0 1 * * 0")
  async cleanupStaleSessions(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result =
      await this.sessions.deleteSessionsLastRequestedBefore(thirtyDaysAgo);

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} stale portal sessions`);
    }
  }
}
