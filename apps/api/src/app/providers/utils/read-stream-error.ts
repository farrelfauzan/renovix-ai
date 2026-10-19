import { ProviderHttpError } from "../errors/provider-http-error";

/** The status a mid-stream error stands for when its code is not an HTTP status. */
const BAD_GATEWAY = 502;

/**
 * The provider error a parsed stream chunk carries, or undefined (RX-22). After the stream opened (HTTP 200) a
 * provider reports a failure as a chunk with a top-level `error` and `finish_reason: "error"`; it is a provider
 * error, never an answer. The error's numeric code becomes the status (502 otherwise).
 */
export function readStreamError(chunk: Record<string, any>): ProviderHttpError | undefined {
  const finishedWithError = chunk.choices?.[0]?.finish_reason === "error";
  if (!chunk.error && !finishedWithError) return undefined;
  const code = Number(chunk.error?.code);
  return new ProviderHttpError({
    message: `Provider stream error: ${chunk.error?.message ?? "finish_reason error"}`,
    status: Number.isInteger(code) && code >= 400 ? code : BAD_GATEWAY,
    bodyText: JSON.stringify(chunk.error ?? {}),
  });
}
