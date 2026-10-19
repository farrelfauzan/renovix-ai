/** What a provider test needs (RX-177): the base URL and the decrypted key, and the row version the test is for. */
export type ProviderConnection = {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** The row's updatedAt when read: the result is stored only if the row has not changed since. */
  readonly updatedAt: Date;
};
