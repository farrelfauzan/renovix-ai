/** Where `testConnection` sends its one test request (RX-177): a provider record's base URL and key, and a model slug. */
export interface ProviderTestTarget {
  readonly baseUrl: string;
  /** Plaintext key, decrypted for this one call; never logged and never part of a result. */
  readonly apiKey: string;
  /** The provider's own model id (D149 option B), sent as `model`. */
  readonly slug: string;
}
