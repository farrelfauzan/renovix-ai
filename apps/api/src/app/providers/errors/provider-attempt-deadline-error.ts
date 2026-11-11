import type { ProviderErrorKind } from "../../../common/types/provider-error-kind";
import { toProviderErrorText } from "../../../common/utils/to-provider-error-text";

/**
 * RNX-284: a single-attempt call (`ChatRequest.singleAttemptTimeoutMs`) passed the deadline its caller chose. Same
 * kind and fixed text as ProviderTimeoutError, but a separate class: a deadline the caller chose is not the provider
 * failing, so it never counts against the provider's circuit breaker (isProviderFailure).
 */
export class ProviderAttemptDeadlineError extends Error {
  readonly kind: ProviderErrorKind = "timeout";

  constructor() {
    super(toProviderErrorText(undefined, "timeout").clientMessage);
    this.name = "ProviderAttemptDeadlineError";
  }
}
