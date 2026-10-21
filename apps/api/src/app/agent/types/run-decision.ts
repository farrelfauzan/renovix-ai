import type { RunScope } from "./run-scope";

/**
 * RNX-119: the run policy's answer for a run entry that does not answer over HTTP (a reminder fire): the run's scope,
 * or why it is refused (the agent is not runnable by this runner, or the runner has no active subscription, D192).
 */
export type RunDecision =
  | { readonly allowed: true; readonly scope: RunScope }
  | { readonly allowed: false; readonly reason: "not_runnable" | "no_subscription" };
