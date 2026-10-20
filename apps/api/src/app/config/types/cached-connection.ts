/** One model's provider record as ModelRegistryService caches it (RX-178): the key stays sealed until a call needs it. */
export interface CachedConnection {
  readonly providerRecordId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  /** Sealed by ProviderKeyCryptoService; opened per call through ProviderRepository, never cached in plaintext. */
  readonly apiKeyCiphertext: string;
}
