import { ProviderHttpError } from "../errors/provider-http-error";
import { ProviderTimeoutError } from "../errors/provider-timeout-error";

/** RNX-179: the lowest HTTP status a circuit breaker counts as the provider failing. */
const SERVER_ERROR_STATUS = 500;

/**
 * RNX-179: whether an error counts against the provider's circuit breaker: a transport failure of that provider (a
 * 5xx answer, no answer in time, or no connection: fetch's TypeError). A 4xx (a bad request, a key or a model the
 * provider refused) means the provider is up, and the caller's abort is not the provider's failure.
 */
export const isProviderFailure = (err: unknown): boolean =>
  (err instanceof ProviderHttpError && err.status >= SERVER_ERROR_STATUS) || err instanceof ProviderTimeoutError || err instanceof TypeError;
