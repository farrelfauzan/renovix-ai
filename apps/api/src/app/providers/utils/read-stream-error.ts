import { ProviderStreamError } from "../errors/provider-stream-error";

/** The status a mid-stream error stands for when its code is not an HTTP error status. */
const BAD_GATEWAY = 502;

/**
 * The provider error a parsed stream chunk carries, or undefined (RX-22). After the stream opened (HTTP 200) a
 * provider reports a failure as a chunk with a top-level `error` and `finish_reason: "error"`; it is a provider
 * error, never an answer. Only the error's numeric code is kept (502 otherwise); its message is never read (D197).
 */
export function readStreamError(chunk: Record<string, any>): ProviderStreamError | undefined {
  const finishedWithError = chunk.choices?.[0]?.finish_reason === "error";
  if (!chunk.error && !finishedWithError) return undefined;
  const code = Number(chunk.error?.code);
  return new ProviderStreamError(Number.isInteger(code) && code >= 400 && code <= 599 ? code : BAD_GATEWAY);
}
