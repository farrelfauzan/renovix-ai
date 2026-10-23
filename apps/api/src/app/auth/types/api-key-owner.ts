/**
 * The user a valid API key belongs to, as ApiKeyGuard attaches it to the request (RNX-18), with the key's id (the
 * per-key rate limit and cap, the ledger attribution) and the model tiers the key may call (RNX-232).
 */
export interface ApiKeyOwner {
  readonly id: string;
  readonly email: string;
  readonly apiKeyId: string;
  readonly allowedTiers: readonly string[];
}
