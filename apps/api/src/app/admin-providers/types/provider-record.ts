import type { ProviderStatus, ProviderType } from "@generated/prisma/client.js";

/** A live provider as ProviderRepository reads it (RX-177): never the key or its ciphertext. */
export type ProviderRecord = {
  readonly id: string;
  readonly type: ProviderType;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKeyHint: string;
  readonly status: ProviderStatus;
  readonly lastTestedAt: Date | null;
  readonly lastTestResult: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Every model on the provider, active or not. */
  readonly _count: { readonly models: number };
};
