/** What a new `api_keys` row holds (RNX-18): the prefix and the hash, never the plaintext; RNX-232: tiers and cap. */
export interface NewApiKeyRow {
  readonly userId: string;
  readonly name: string;
  readonly prefix: string;
  readonly keyHash: string;
  readonly expiresAt: Date | null;
  readonly allowedTiers: string[];
  readonly monthlyCreditCap: number | null;
}
