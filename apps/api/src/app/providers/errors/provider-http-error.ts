/**
 * The provider answered a chat or embedding request with an error status (RX-169, RX-161).
 * `bodyText` is the response body, already read to the end as text (never parsed as
 * JSON: a gateway may answer in plain text). `retryAfterMs` is the Retry-After header, if any.
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;
  readonly retryAfterMs?: number;

  constructor(params: { message: string; status: number; bodyText: string; retryAfterMs?: number }) {
    super(params.message);
    this.name = "ProviderHttpError";
    this.status = params.status;
    this.bodyText = params.bodyText;
    this.retryAfterMs = params.retryAfterMs;
  }
}
