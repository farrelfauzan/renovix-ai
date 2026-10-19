import { ProviderHttpError } from "../errors/provider-http-error";

/** Authentication refusals get their own fixed text. */
const AUTH_REFUSED_STATUSES: readonly number[] = [401, 403];

/**
 * A readable reason for a failed provider test request (RX-177): the status with a fixed short text, a
 * timeout, or the network error. The provider's answer body is never kept (D195): it can echo part of the
 * key or its hash (RX-174, RX-190), and the reason is readable by providers:read roles. Any
 * occurrence of the key is replaced, so the reason can be stored and returned.
 */
export function describeTestFailure(err: unknown, apiKey: string, timeoutMs: number): string {
  const error = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const reason =
    err instanceof ProviderHttpError
      ? AUTH_REFUSED_STATUSES.includes(err.status)
        ? `The provider answered ${err.status}: the key was refused`
        : `The provider answered ${err.status}: the request was refused`
      : error?.name === "TimeoutError"
        ? `No answer within ${timeoutMs / 1000} seconds`
        : `The request failed: ${error?.message ?? String(err)}${error?.cause ? ` (${error.cause.code ?? error.cause.message})` : ""}`;
  return apiKey ? reason.split(apiKey).join("[key]") : reason;
}
