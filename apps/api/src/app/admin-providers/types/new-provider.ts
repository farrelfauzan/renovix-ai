import type { ProviderType } from "@generated/prisma/client.js";

/** A provider to create (RX-177), with the plaintext key ProviderRepository seals before it is written. */
export type NewProvider = {
  readonly type: ProviderType;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly adminId: string;
};
