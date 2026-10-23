import { NO_PROVIDER_RECORD } from "../config/no-provider-record";

/** The provider record id of a report row, or "no provider record" for the calls without one (RNX-228). */
export function toProviderLabel(providerId: string | null | undefined): string {
  return providerId ?? NO_PROVIDER_RECORD;
}
