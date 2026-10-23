/**
 * The reconciliation job's batch (RNX-35): orders claimed per run, and how long a claim keeps other runs off a row.
 * A claim is not released after the check (RNX-271): it holds until just before the next interval's run, so a run of
 * another instance in the same interval skips the order and it is checked (and an unknown answer counted) once per
 * interval. `claimSlackSeconds` is taken off the interval because the cron fires on minute boundaries and the scheduler
 * rounds the minutes since its last run, so the next run can come up to about 30 s early; without it the order would
 * wait a whole extra interval. It stays below one minute, so with the shortest interval (1 minute, the setting's
 * minimum) the claim still ends after the run's now. `fallbackClaimMinutes` is the claim while
 * `paymentsReconcileEveryMinutes` is not set (the scheduler does not run then, but `reconcile()` can still be called).
 */
export const RECONCILE_BATCH = {
  size: 100,
  claimSlackSeconds: 30,
  fallbackClaimMinutes: 5,
} as const;
