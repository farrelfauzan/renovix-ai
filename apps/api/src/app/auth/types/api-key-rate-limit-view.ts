/** The per-key rate limit as GET /auth/keys/rate-limit answers it (RNX-82): requests per key per minute. */
export interface ApiKeyRateLimitView {
  readonly requestsPerMinute: number;
}
