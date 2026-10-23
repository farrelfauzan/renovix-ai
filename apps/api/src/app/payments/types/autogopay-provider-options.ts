import type { AutoGoPayTransport } from "./autogopay-transport";

/** How an AutoGoPayProvider is built (RNX-229): the API key (also the webhook signing key) and the transport. */
export type AutoGoPayProviderOptions = {
  readonly apiKey: string;
  readonly transport: AutoGoPayTransport;
};
