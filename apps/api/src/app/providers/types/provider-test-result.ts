/** The outcome of one provider test request (RX-177): success, or a readable reason that never contains the key. */
export interface ProviderTestResult {
  readonly isSuccessful: boolean;
  readonly reason: string | null;
}
