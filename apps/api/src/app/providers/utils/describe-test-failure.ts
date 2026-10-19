import { ProviderHttpError } from "../errors/provider-http-error";

/** Authentication refusals get their own fixed text. */
const AUTH_REFUSED_STATUSES: readonly number[] = [401, 403];

/**
 * A readable reason for a failed provider test request (RX-177): fixed text only (D195, D197). An HTTP
 * error gives its status with a fixed text, a timeout says so, and any other transport or parse failure
 * gives one fixed sentence. No error message or answer body is copied: they can quote the provider's answer,
 * which can echo part of the key or its hash (RX-174, RX-190), and the reason is readable by providers:read
 * roles.
 */
export function describeTestFailure(err: unknown, timeoutMs: number): string {
  if (err instanceof ProviderHttpError) {
    return AUTH_REFUSED_STATUSES.includes(err.status)
      ? `The provider answered ${err.status}: the key was refused`
      : `The provider answered ${err.status}: the request was refused`;
  }
  if ((err as { name?: string } | undefined)?.name === "TimeoutError") return `No answer within ${timeoutMs / 1000} seconds`;
  return "The request failed: the provider could not be reached or its answer could not be read";
}
