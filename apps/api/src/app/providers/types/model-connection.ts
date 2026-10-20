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
}
