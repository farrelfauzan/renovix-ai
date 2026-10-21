/** What a new `api_keys` row holds (RNX-18): the prefix and the hash, never the plaintext. */
export interface NewApiKeyRow {
  readonly userId: string;
  readonly name: string;
  readonly prefix: string;
  readonly keyHash: string;
  readonly expiresAt: Date | null;
}
