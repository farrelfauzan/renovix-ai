/**
 * RNX-44: `work`, cut at the budget's signal: rejects with the signal's reason (ProviderTimeBudgetExceededError) when
 * it fires first, whether or not the adapter honours the signal. Without a signal it is `work` itself.
 */
export function withinCallBudget<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onExpired = (): void => reject(signal.reason);
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onExpired));
    if (signal.aborted) return onExpired();
    signal.addEventListener("abort", onExpired, { once: true });
  });
}
