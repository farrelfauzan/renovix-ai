/**
 * RNX-326: a run with agent calls reached a run limit: its model-call cap (`peerRunMaxModelCalls`, root and hops
 * together) or its run time limit (`peerRunMaxMinutes`, cut at the route's socket timeout). The model call running is
 * aborted with this error as the reason, no further call starts, and the run ends with the budget-stop answer and
 * the stop reason `limit_stopped`; what ran stays charged and the reservation is settled. A separate class: the
 * platform's own limit is neither the provider failing (the circuit breaker does not count it, isProviderFailure)
 * nor the client's disconnect (D336).
 */
export class RunLimitStoppedError extends Error {
  constructor(readonly limit: "model_calls" | "run_time") {
    super(`The run stopped at its ${limit === "model_calls" ? "model-call" : "time"} limit`);
    this.name = "RunLimitStoppedError";
  }
}
