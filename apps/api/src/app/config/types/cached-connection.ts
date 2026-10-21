import type { Decimal } from "@prisma/client/runtime/client";

/** One model's provider record as ModelRegistryService caches it (RX-178): the key stays sealed until a call needs it. */
export interface CachedConnection {
  readonly providerRecordId: string;
  readonly providerName: string;
  readonly baseUrl: string;
  /** Sealed by ProviderKeyCryptoService; opened per call through ProviderRepository, never cached in plaintext. */
  readonly apiKeyCiphertext: string;
  /** RNX-162: the provider record's cost settings (null when off). */
  readonly costMultiplier: Decimal | null;
  readonly perCallFloorUsd: Decimal | null;
  readonly highCaseFactor: Decimal | null;
  readonly highCaseTokenThreshold: number | null;
}
