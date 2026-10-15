/** Where the chat adapter sends a request (RX-160): the primary provider or the optional fallback. */
export interface LlmEndpoint {
  /** Shown in log lines together with the host; the key never is. */
  readonly label: "primary" | "fallback";
  readonly baseUrl: string;
  readonly apiKey: string;
}
