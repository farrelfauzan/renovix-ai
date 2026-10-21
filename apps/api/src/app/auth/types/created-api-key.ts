import type { ApiKeyView } from "./api-key-view";

/** A new API key (RNX-18): its fields and the plaintext key, which is shown this once and stored nowhere. */
export interface CreatedApiKey extends ApiKeyView {
  readonly apiKey: string;
}
