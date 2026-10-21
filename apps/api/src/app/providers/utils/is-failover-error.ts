import { ProviderHttpError } from "../errors/provider-http-error";

/** RNX-179: the statuses that move a call to the next fallback model. Not 400, 401/403 (RNX-102) or network errors (RNX-174). */
const FAILOVER_STATUSES: readonly number[] = [502, 503];

/** RNX-179: whether a provider error moves the call to the next fallback model (a 502 or 503 answer). */
export const isFailoverError = (err: unknown): boolean => err instanceof ProviderHttpError && FAILOVER_STATUSES.includes(err.status);
