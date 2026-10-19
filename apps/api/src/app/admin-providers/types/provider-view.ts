/** A provider as the /admin/providers routes return it (RX-177): `hasApiKey` and the last 4 characters only, never the key. */
export type ProviderView = {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly status: string;
  readonly hasApiKey: boolean;
  readonly apiKeyHint: string;
  readonly lastTestedAt: Date | null;
  /** "success", or the readable reason of the last failed test; null when untested since the last key or base URL change. */
  readonly lastTestResult: string | null;
  /** Every model on the provider, active or not. */
  readonly modelCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
