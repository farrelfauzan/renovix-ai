/** An API key as the list and the create route answer with it (RNX-18): never the hash or the plaintext. */
export interface ApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
}
