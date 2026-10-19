/**
 * A change to a provider (RX-177). A new `apiKey` (plaintext) is sealed by ProviderRepository; a new key
 * or base URL clears the last test result.
 */
export type ProviderChanges = {
  readonly name?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly status?: "inactive";
  readonly adminId: string;
};
