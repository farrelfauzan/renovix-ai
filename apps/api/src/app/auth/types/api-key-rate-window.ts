/** One API key's current one-minute window of the per-key rate limit (RNX-232): when it started, requests counted. */
export interface ApiKeyRateWindow {
  readonly startedAt: number;
  count: number;
}
