/**
 * The provider reported a failure inside an open stream (HTTP 200, a chunk with a top-level `error`), RX-22. It carries
 * only the numeric status: the provider's text never leaves the adapter boundary (D197; texts from
 * `toProviderErrorText`).
 */
export class ProviderStreamError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Provider stream error");
    this.name = "ProviderStreamError";
    this.status = status;
  }
}
