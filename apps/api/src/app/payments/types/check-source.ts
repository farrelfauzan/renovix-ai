/** What made a status check (RNX-35): a verified webhook, the reconciliation job, or an admin's "confirm from provider". */
export type CheckSource = "webhook" | "reconcile" | "admin";
