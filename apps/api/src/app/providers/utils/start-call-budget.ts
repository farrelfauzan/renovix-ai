import { ProviderTimeBudgetExceededError } from "../errors/provider-time-budget-exceeded-error";
import type { RunningCallBudget } from "../types/running-call-budget";

/** RNX-44: starts a call's time budget of `timeBudgetMs`: its own signal aborts with ProviderTimeBudgetExceededError when it runs out. */
export function startCallBudget(timeBudgetMs: number): RunningCallBudget {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ProviderTimeBudgetExceededError()), timeBudgetMs);
  return { signal: controller.signal, deadlineAt: Date.now() + timeBudgetMs, stop: () => clearTimeout(timer) };
}
