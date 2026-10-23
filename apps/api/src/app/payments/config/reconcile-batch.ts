/** The reconciliation job's batch (RNX-35): orders claimed per run, and how long a claim keeps other instances off a row. */
export const RECONCILE_BATCH = {
  size: 100,
  claimMinutes: 5,
} as const;
