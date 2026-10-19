/** Where the chat adapter sends a request: a provider record's connection (RX-178), or the env endpoint of GET /models. */
export interface LlmEndpoint {
  readonly baseUrl: string;
  readonly apiKey: string;
}
