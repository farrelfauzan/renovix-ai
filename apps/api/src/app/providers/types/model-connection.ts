import type { CallCostBasis } from "./call-cost-basis";

/**
 * Where one chat call goes (RX-178, D199): the model's provider record, resolved from the request's slug by
 * ModelRegistryService.resolveConnection. Every chat call carries one on ChatRequest.
 */
export interface ModelConnection {
  /** The model slug, sent as `model` as it is (D149 option B: the slug is the provider's own model id). */
  readonly slug: string;
  readonly baseUrl: string;
  /** Plaintext key, decrypted for this call only; never logged and never part of a response. */
  readonly apiKey: string;
  /** The provider record's name, for log lines and usage rows. */
  readonly providerName: string;
  /**
   * RNX-179: the provider record's id, the key of its circuit breaker in ProviderRouter. Absent on a connection that
   * is not a provider record (LLM_PROVIDER=fake, hand-built test connections): such a call has no breaker.
   */
  readonly providerRecordId?: string;
  /**
   * RNX-179 (D58, D149): the model's usable fallback models, in order, each with its own provider and slug; a 502 or
   * 503 moves the call to the next one. A fallback has none itself.
   */
  readonly fallbacks?: readonly ModelConnection[];
  /** RNX-162: the model's prices and its provider record's cost settings; absent without a provider record. */
  readonly costBasis?: CallCostBasis;
}
