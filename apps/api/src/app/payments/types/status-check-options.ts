/** How a status check is made (RNX-229, D280): a shorter total timeout than the adapter's own (the webhook path). */
export type StatusCheckOptions = {
  readonly timeoutMs?: number;
};
