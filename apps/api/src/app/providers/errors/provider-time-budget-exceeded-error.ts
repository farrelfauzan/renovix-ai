import type { ProviderErrorKind } from "../../../common/types/provider-error-kind";

/** RNX-44: the fixed text of a model call that ran out of its time budget (D197: never provider text). */
const TIME_BUDGET_EXCEEDED_TEXT = "Model call time budget exceeded";

/**
 * RNX-44: one user-facing model call ran out of its time budget (`ChatRequest.timeBudgetMs`) across its tries,
 * back-off waits and fallback models (a stream: until its first token). Kind timeout, but a separate class: the budget
 * is the platform's own limit, not the provider failing, so it never counts against the provider's circuit breaker
 * (isProviderFailure), and it is never the caller's abort (a client disconnect).
 */
export class ProviderTimeBudgetExceededError extends Error {
  readonly kind: ProviderErrorKind = "timeout";

  constructor() {
    super(TIME_BUDGET_EXCEEDED_TEXT);
    this.name = "ProviderTimeBudgetExceededError";
  }
}
