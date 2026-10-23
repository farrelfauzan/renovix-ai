import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import type { ApiKeyRateWindow } from "../types/api-key-rate-window";

/** The window of the per-key limit. */
const WINDOW_MS = 60_000;
/** D47 (the ApiKeys artboard): requests per minute per key while the setting has no value. */
const DEFAULT_REQUESTS_PER_MINUTE = 60;

/**
 * The per-key rate limit (RNX-232, D47): at most `apiKeyRequestsPerMinute` requests per key in a fixed one-minute
 * window, counted in memory on this instance (accepted: no shared store). Runs after the key check (AccessGuard);
 * the per-IP throttler stays in front of it. Windows that ended are dropped at most once a minute.
 */
@Injectable()
export class ApiKeyRateLimitService {
  private readonly windows = new Map<string, ApiKeyRateWindow>();
  private sweptAt = 0;

  constructor(private readonly settings: PlatformSettingsService) {}

  /** Counts one request of this key; 429 when the key already made the limit's number of requests in this window. */
  async consume(apiKeyId: string): Promise<void> {
    const limit = (await this.settings.getSetting("apiKeyRequestsPerMinute")) ?? DEFAULT_REQUESTS_PER_MINUTE;
    const now = Date.now();
    this.dropEndedWindows(now);
    const window = this.windows.get(apiKeyId);
    if (!window || now - window.startedAt >= WINDOW_MS) {
      this.windows.set(apiKeyId, { startedAt: now, count: 1 });
      return;
    }
    if (window.count >= limit) {
      throw new HttpException("Too many requests for this API key", HttpStatus.TOO_MANY_REQUESTS);
    }
    window.count += 1;
  }

  /** Forgets the windows that ended, at most once a window, so keys that stopped calling do not stay in memory. */
  private dropEndedWindows(now: number): void {
    if (now - this.sweptAt < WINDOW_MS) return;
    this.sweptAt = now;
    for (const [apiKeyId, window] of this.windows) {
      if (now - window.startedAt >= WINDOW_MS) this.windows.delete(apiKeyId);
    }
  }
}
