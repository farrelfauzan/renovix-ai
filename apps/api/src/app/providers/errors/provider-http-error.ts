/**
 * The provider answered a streamed chat request with an error status (RX-169).
 * `bodyText` is the response body, already read to the end: callers read it
 * here, never from the consumed response stream.
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(params: { message: string; status: number; bodyText: string }) {
    super(params.message);
    this.name = "ProviderHttpError";
    this.status = params.status;
    this.bodyText = params.bodyText;
  }
}
