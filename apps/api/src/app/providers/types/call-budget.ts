/**
 * RNX-44: the time budget of one model call, set by ProviderRouter on the request it gives the adapter (never sent).
 * `signal` is the budget's own (never the caller's): it aborts with a ProviderTimeBudgetExceededError at `deadlineAt`
 * (epoch milliseconds, Date.now()).
 */
export interface CallBudget {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
}
